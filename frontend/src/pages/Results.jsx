import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getCareerAnalysis, simulateWhatIf } from '../services/api';

const LOCAL_ROLE_REQUIREMENTS = [
  {
    id: 'data-scientist',
    name: 'Data Scientist',
    icon: '📊',
    futureScope: 'High demand and long-term growth in data-driven teams.',
    requiredSkills: ['Python', 'Machine Learning', 'SQL', 'Statistics'],
  },
  {
    id: 'ml-engineer',
    name: 'ML Engineer',
    icon: '🧠',
    futureScope: 'Strong hiring momentum for production AI and automation systems.',
    requiredSkills: ['Python', 'TensorFlow', 'APIs', 'Deployment'],
  },
  {
    id: 'backend-developer',
    name: 'Backend Developer',
    icon: '⚙️',
    futureScope: 'Steady demand across SaaS, product, and platform engineering teams.',
    requiredSkills: ['Node.js', 'Databases', 'APIs'],
  },
  {
    id: 'data-analyst',
    name: 'Data Analyst',
    icon: '📈',
    futureScope: 'Growing demand for business analytics and decision support roles.',
    requiredSkills: ['SQL', 'Excel', 'Visualization'],
  },
];

const buildLocalDynamicCareers = (normalizedScores) => {
  const scores = normalizedScores || {};

  return LOCAL_ROLE_REQUIREMENTS.map((role, index) => {
    const required = role.requiredSkills || [];
    const requiredCount = required.length || 1;

    const scored = required.map((skill) => {
      const numeric = Number(scores[skill]);
      const value = Number.isFinite(numeric) ? Math.max(0, Math.min(10, numeric)) : 0;
      return { skill, value };
    });

    const total = scored.reduce((sum, item) => sum + item.value, 0);
    const match = Math.round((total / (10 * requiredCount)) * 100);
    const domainGap = Math.max(0, 100 - match);

    const missingWithScores = scored
      .filter((item) => item.value < 6)
      .sort((a, b) => a.value - b.value);

    const matchedSkills = scored.filter((item) => item.value >= 6).map((item) => item.skill);
    const missingSkills = missingWithScores.map((item) => item.skill);
    const techGap = Math.round((missingSkills.length / requiredCount) * 100);

    const leadSkill = missingSkills[0];
    const suggestion = leadSkill
      ? `Prioritize ${leadSkill} first to improve your ${role.name} fit.`
      : `You are aligned for ${role.name}; focus on advanced projects and interview prep.`;
    const learningPath = [
      leadSkill ? `Strengthen ${leadSkill} with guided practice.` : `Advance your core ${role.name} skill set.`,
      `Build one mini project using ${required.slice(0, 2).join(' and ')}.`,
      `Create a portfolio-ready ${role.name} case study and apply for internships/junior roles.`,
    ];

    return {
      id: `local-${role.id}`,
      name: role.name,
      description: `Computed from your current skill profile for ${role.name}.`,
      icon: role.icon,
      match,
      domainGap,
      techGap,
      futureScope: role.futureScope,
      requiredSkills: required,
      matchedSkills,
      missingSkills,
      suggestion,
      learningPath,
      detailsAvailable: false,
      _order: index,
    };
  }).sort((a, b) => b.match - a.match || a._order - b._order);
};

const Results = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const skills = useMemo(() => location.state?.skills || [], [location.state?.skills]);
  const domain = location.state?.domain || 'General';
  const quizScore = location.state?.quizScore || 0;
  const totalQuestions = location.state?.totalQuestions || 5;
  const [selectedSkill, setSelectedSkill] = useState('');
  const [simulationResult, setSimulationResult] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [simulationError, setSimulationError] = useState('');
  const [openSuggestionCard, setOpenSuggestionCard] = useState(null);
  const [expandedFutureScopeCards, setExpandedFutureScopeCards] = useState({});
  const [generatedCareers, setGeneratedCareers] = useState([]);
  const [careersLoading, setCareersLoading] = useState(false);
  const [careersError, setCareersError] = useState('');
  const [careersSource, setCareersSource] = useState('fallback');

  const quizPercentage = Math.round((quizScore / (totalQuestions * 20)) * 100) || 0;
  // FIX: Display as percentage, not decimal
  const displayQuizPercentage = quizPercentage > 10 ? quizPercentage : Math.round((quizScore / totalQuestions) * 100);

  const skillOptions = useMemo(() => {
    if (skills.length > 0) {
      return skills;
    }
    return ['Python', 'SQL', 'JavaScript', 'Problem Solving'];
  }, [skills]);

  const currentScores = useMemo(() => {
    const base = location.state?.currentScores;
    if (base && typeof base === 'object' && Object.keys(base).length > 0) {
      return base;
    }

    return skillOptions.reduce((acc, skill) => {
      acc[skill] = quizPercentage;
      return acc;
    }, {});
  }, [location.state?.currentScores, skillOptions, quizPercentage]);

  const normalizedCurrentScores = useMemo(() => {
    const result = Object.entries(currentScores).reduce((acc, [skill, score]) => {
      const numeric = Number(score);
      const zeroToHundred = Number.isNaN(numeric) ? 0 : Math.max(0, Math.min(100, numeric));
      acc[skill] = Math.round(zeroToHundred) / 10;
      return acc;
    }, {});
    console.log('[Results] 📈 Raw currentScores from Quiz:', currentScores);
    console.log('[Results] 🔄 Normalized to 0-10 scale:', result);
    return result;
  }, [currentScores]);

  const topicWiseScores = useMemo(() => {
    return Object.entries(currentScores)
      .map(([topic, score]) => ({
        topic,
        score: Math.max(0, Math.min(100, Math.round(Number(score) || 0))),
      }))
      .sort((a, b) => b.score - a.score || a.topic.localeCompare(b.topic));
  }, [currentScores]);

  const handleSimulate = async () => {
    const skill = selectedSkill || skillOptions[0];
    if (!skill) {
      return;
    }

    setSimulating(true);
    setSimulationError('');
    try {
      const response = await simulateWhatIf(skill, currentScores, domain);
      setSimulationResult(response.simulation || null);
    } catch (error) {
      setSimulationError('Simulation failed. Please try again.');
    } finally {
      setSimulating(false);
    }
  };

  useEffect(() => {
    const loadCareerResults = async () => {
      if (!skillOptions.length) {
        setGeneratedCareers([]);
        return;
      }

      setCareersLoading(true);
      setCareersError('');
      try {
        console.log('[Results] 🔍 CALLING CAREER API with normalized scores:', normalizedCurrentScores);
        const response = await getCareerAnalysis({
          skills: normalizedCurrentScores,
          domain: domain || 'general'
        });
        console.log('[Results] 📡 API RESPONSE:', response);
        
        if (response.careers && response.careers.length > 0) {
          console.log('[Results] 🎯 Top 3 careers missing skills:');
          response.careers.slice(0, 3).forEach((c, i) => {
            console.log(`  ${i + 1}. ${c.title}: missing=[${c.missing_skills?.join(', ')}]`);
          });
        }

        const mapped = Array.isArray(response.careers)
          ? response.careers.map((career, index) => {
              const matchedSkills = Array.isArray(career.matched_skills) ? career.matched_skills : [];
              const missingSkills = Array.isArray(career.missing_skills) ? career.missing_skills : [];
              const requiredSkills = [...matchedSkills, ...missingSkills];
              const derivedMatch = Number.isFinite(Number(career.match))
                ? Math.max(0, Math.min(100, Math.round(Number(career.match))))
                : 0;

              const domainGap = Number.isFinite(Number(career.domain_gap))
                ? Math.max(0, Math.min(100, Math.round(Number(career.domain_gap))))
                : Math.max(0, 100 - derivedMatch);

              const techGap = Number.isFinite(Number(career.tech_gap))
                ? Math.max(0, Math.min(100, Math.round(Number(career.tech_gap))))
                : (requiredSkills.length ? Math.round((missingSkills.length / requiredSkills.length) * 100) : Math.max(0, 100 - derivedMatch));

              const explanation =
                career.llm_output?.explanation
                || career.match_reason
                || career.career_goal
                || 'Recommended based on your quiz profile';

              const recommendationPath = [
                ...(Array.isArray(career.llm_output?.tech_recommendations) ? career.llm_output.tech_recommendations : []),
                ...(Array.isArray(career.llm_output?.tools)
                  ? career.llm_output.tools.map((tool) => `Use ${tool} in projects`)
                  : []),
              ];
              const uniquePath = Array.from(new Set(
                recommendationPath
                  .map((item) => String(item || '').trim())
                  .filter(Boolean)
              ));

              const fallbackPath = [
                ...(missingSkills.length ? [`Improve ${missingSkills[0]} through focused exercises.`] : []),
                ...(requiredSkills.length ? [`Build a project covering ${requiredSkills.slice(0, 2).join(' and ')}.`] : []),
                'Publish your work and prepare for role-specific interviews.',
              ];

              return {
                id: `generated-${index + 1}`,
                name: career.title || `Career ${index + 1}`,
                description: explanation,
                icon: '✨',
                match: derivedMatch,
                domainGap,
                techGap,
                futureScope: career.llm_output?.future_scope || career.future_scope || 'Steady market demand expected in this domain.',
                requiredSkills,
                matchedSkills,
                missingSkills,
                suggestion:
                  (Array.isArray(career.llm_output?.tech_recommendations) && career.llm_output.tech_recommendations.join(' '))
                  || career.suggestion
                  || 'Improve missing skills and build project experience.',
                learningPath: uniquePath.length > 0 ? uniquePath.slice(0, 5) : fallbackPath,
                detailsAvailable: false,
              };
            })
          : [];

        if (mapped.length > 0) {
          setGeneratedCareers(mapped);
          setCareersSource(response.source || 'groq');
        } else {
          const localDynamic = buildLocalDynamicCareers(normalizedCurrentScores);
          setGeneratedCareers(localDynamic);
          setCareersSource('local-dynamic');
        }
      } catch (error) {
        const localDynamic = buildLocalDynamicCareers(normalizedCurrentScores);
        setGeneratedCareers(localDynamic);
        setCareersSource('local-dynamic');
        setCareersError('Groq is unavailable right now. Showing dynamic backend-style calculations from your quiz scores.');
      } finally {
        setCareersLoading(false);
      }
    };

    loadCareerResults();
  }, [normalizedCurrentScores, skillOptions, domain]);

  // Sort careers by match score
  const topCareers = useMemo(() => {
    return [...generatedCareers].sort((a, b) => b.match - a.match);
  }, [generatedCareers]);

  // Final visible percentage should prefer career-match average,
  // but fall back to quiz percentage when matches are all zero.
  const resultPercentage = useMemo(() => {
    if (!topCareers.length) {
      return displayQuizPercentage;
    }
    const considered = topCareers.slice(0, 3);
    const average = considered.reduce((sum, career) => sum + (career.match || 0), 0) / considered.length;
    const roundedAverage = Math.round(average);

    if (!Number.isFinite(roundedAverage) || roundedAverage <= 0) {
      return displayQuizPercentage;
    }

    return roundedAverage;
  }, [topCareers, displayQuizPercentage]);

  const hasUsableCareerScores = useMemo(() => {
    if (!topCareers.length) {
      return false;
    }
    const considered = topCareers.slice(0, 3);
    const average = considered.reduce((sum, career) => sum + (career.match || 0), 0) / considered.length;
    const roundedAverage = Math.round(average);
    return Number.isFinite(roundedAverage) && roundedAverage > 0;
  }, [topCareers]);

  const averageDomainGap = useMemo(() => {
    if (!topCareers.length || !hasUsableCareerScores) {
      return Math.max(0, 100 - resultPercentage);
    }

    const considered = topCareers.slice(0, 3);
    const totalGap = considered.reduce((sum, career) => {
      if (Number.isFinite(Number(career.domainGap))) {
        return sum + Number(career.domainGap);
      }
      return sum + Math.max(0, 100 - (career.match || 0));
    }, 0);

    return Math.round(totalGap / considered.length);
  }, [topCareers, resultPercentage, hasUsableCareerScores]);

  const techGapAgainstTop = useMemo(() => {
    // Tech gap should represent role-skill deficiency against top candidates.
    // Even if match scores are weak/zero, this can still be informative.
    if (!topCareers.length) {
      return Math.max(0, 100 - resultPercentage);
    }

    const considered = topCareers.slice(0, 3);
    const totalGap = considered.reduce((sum, career) => {
      if (Number.isFinite(Number(career.techGap))) {
        return sum + Number(career.techGap);
      }

      const requiredCount = career.requiredSkills?.length || 0;
      if (requiredCount > 0) {
        return sum + Math.round(((career.missingSkills?.length || 0) / requiredCount) * 100);
      }

      return sum + Math.max(0, 100 - (career.match || 0));
    }, 0);

    return Math.round(totalGap / considered.length);
  }, [topCareers, resultPercentage]);

  const commonMissingSkills = useMemo(() => {
    const priority = {};
    topCareers.slice(0, 3).forEach((career, index) => {
      const careerWeight = 3 - index;
      (career.missingSkills || []).forEach((skill) => {
        const userScore = Number(normalizedCurrentScores[skill] ?? 0);
        const deficit = Math.max(0, 6 - userScore);
        const selectedSkillBonus = skillOptions.includes(skill) ? 2 : 0;
        const score = (careerWeight * Math.max(1, deficit)) + selectedSkillBonus;
        priority[skill] = (priority[skill] || 0) + score;
      });
    });
    const result = Object.keys(priority)
      .sort((a, b) => (priority[b] - priority[a]) || a.localeCompare(b))
      .slice(0, 4);
    
    console.log('[Results] 📊 Priority Skill Gaps calculation:');
    console.log('   Top careers:', topCareers.slice(0, 3).map(c => ({ name: c.name, missing: c.missingSkills })));
    console.log('   User normalized scores:', normalizedCurrentScores);
    console.log('   Priority weights:', priority);
    console.log('   Final gaps:', result);
    
    return result;
  }, [topCareers, normalizedCurrentScores, skillOptions]);

  const personalizedDirection = useMemo(() => {
    const region = domain || 'General';
    if (resultPercentage >= 80) {
      return `You are highly ready for ${region}-focused roles. Prioritize advanced projects and interview prep.`;
    }
    if (resultPercentage >= 60) {
      return `You are in the growth zone for ${region}. Closing skill gaps now can move you to top-tier matches.`;
    }
    return `You are in the foundation stage for ${region}. Build core skills first, then target role-specific projects.`;
  }, [domain, resultPercentage]);

  const futureScopeSummary = useMemo(() => {
    const first = topCareers[0]?.futureScope;
    if (first) {
      return first;
    }
    return resultPercentage >= 70
      ? 'Strong future scope if you continue consistent upskilling.'
      : 'Good future scope, but skill acceleration is needed to stay competitive.';
  }, [topCareers, resultPercentage]);

  return (
    <div className="space-y-12">
      {/* Summary Card */}
      <section className="card-surface p-8 bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="headline-display text-3xl font-bold text-gray-900 mb-2">
              Your Career Results 🎉
            </h1>
            <p className="text-gray-600">Based on your skills and quiz answers</p>
          </div>
          <div className="text-right">
            <p className="text-5xl font-bold text-blue-600">{resultPercentage}%</p>
            <p className="text-sm text-gray-600 mt-1">Match Score</p>
            <p className="text-xs text-gray-500 mt-1">Quiz: {quizPercentage}%</p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="rounded-lg bg-white/80 p-3 border border-blue-200">
            <p className="text-xs text-gray-600 font-semibold">SKILLS PROVIDED</p>
            <p className="text-lg font-bold text-gray-900 mt-1">{skills.length}</p>
          </div>
          <div className="rounded-lg bg-white/80 p-3 border border-blue-200">
            <p className="text-xs text-gray-600 font-semibold">INTEREST AREA</p>
            <p className="text-sm font-bold text-gray-900 mt-1 truncate">{domain}</p>
          </div>
          <div className="rounded-lg bg-white/80 p-3 border border-blue-200">
            <p className="text-xs text-gray-600 font-semibold">READINESS</p>
            <p className="text-lg font-bold text-gray-900 mt-1">
              {resultPercentage >= 80 ? '✨ High' : resultPercentage >= 60 ? '🌱 Medium' : '🚀 Emerging'}
            </p>
          </div>
        </div>
      </section>

      {/* Personalized Intelligence */}
      <section className="bg-white rounded-xl shadow-md p-6">
        <div className="mb-4">
          <h2 className="section-title">Result Intelligence</h2>
          <p className="section-subtitle mt-2">
            Suggestions based on your score ({resultPercentage}%) and interest area ({domain}).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 font-semibold">REGION OF INTEREST</p>
            <p className="text-lg font-bold text-gray-900 mt-1">{domain}</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs text-amber-700 font-semibold">DOMAIN GAP</p>
            <p className="text-lg font-bold text-amber-700 mt-1">{averageDomainGap}%</p>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-xs text-red-700 font-semibold">TECH GAP VS TOP CANDIDATES</p>
            <p className="text-lg font-bold text-red-700 mt-1">{techGapAgainstTop}%</p>
          </div>
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <p className="text-xs text-green-700 font-semibold">FUTURE SCOPE</p>
            <p className="text-sm font-semibold text-green-700 mt-1">{resultPercentage >= 70 ? 'High' : 'Moderate-High'}</p>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-900">Suggested Direction</p>
          <p className="text-sm text-gray-700 mt-1">{personalizedDirection}</p>
        </div>

        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-semibold text-blue-800">Future Scope Insight</p>
          <p className="text-sm text-blue-700 mt-1">{futureScopeSummary}</p>
        </div>

        {commonMissingSkills.length > 0 && (
          <div className="mt-4 rounded-lg border border-gray-200 p-4">
            <p className="text-sm font-semibold text-gray-900 mb-2">Priority Skill Gaps</p>
            <div className="flex flex-wrap gap-2">
              {commonMissingSkills.map((skill) => (
                <span key={skill} className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-sm text-red-700">
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Top Matches */}
      <section>
        <div className="mb-6">
          <h2 className="section-title">Best Career Matches</h2>
          <p className="section-subtitle mt-2">
            Ranked by compatibility with your profile
            {careersLoading ? ' • updating from quiz results...' : ` • source: ${careersSource}`}
          </p>
          {careersError && <p className="text-sm text-amber-700 mt-2">{careersError}</p>}
        </div>

        <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {topCareers.map((career) => {
            const futureScopeText = career.futureScope || 'Good scope with continuous upskilling.';
            const isFutureScopeExpanded = Boolean(expandedFutureScopeCards[career.id]);

            return (
            <div
              key={career.id}
              className="bg-white rounded-xl shadow-md hover:shadow-lg hover:scale-105 transition-transform duration-300 border border-gray-200 p-6 cursor-pointer"
              onClick={() => {
                if (career.detailsAvailable !== false) {
                  navigate(`/career/${career.id}`, { state: { skills, domain } });
                }
              }}
            >
              <div className="text-4xl mb-4">{career.icon}</div>
              <h3 className="text-lg font-bold text-blue-700">{career.name}</h3>
              <p className="text-sm text-gray-600 mt-2">{career.description}</p>

              <div className="mt-3 rounded-md bg-green-50 border border-green-200 p-3">
                <p className="text-[10px] font-semibold text-green-700">FUTURE SCOPE</p>
                <p
                  className="text-xs text-green-700 mt-1"
                  style={!isFutureScopeExpanded ? {
                    display: '-webkit-box',
                    WebkitLineClamp: 4,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  } : undefined}
                >
                  {futureScopeText}
                </p>
                <button
                  type="button"
                  className="mt-2 text-[11px] font-semibold text-green-800 hover:underline"
                  onClick={(event) => {
                    event.stopPropagation();
                    setExpandedFutureScopeCards((current) => ({
                      ...current,
                      [career.id]: !Boolean(current[career.id]),
                    }));
                  }}
                >
                  {isFutureScopeExpanded ? 'Show less' : 'Read more'}
                </button>
              </div>

              {openSuggestionCard === career.id && (
                <div className="mt-3 rounded-md bg-blue-50 border border-blue-200 p-3">
                  <p className="text-[10px] font-semibold text-blue-700">AI SUGGESTION</p>
                  <p className="text-xs text-blue-800 mt-1">{career.suggestion || 'Focus on high-impact skills and consistent project work.'}</p>

                  <p className="text-[10px] font-semibold text-blue-700 mt-3">PATH REQUIRED</p>
                  <ol className="mt-1 space-y-1 list-decimal list-inside">
                    {(career.learningPath && career.learningPath.length > 0
                      ? career.learningPath
                      : [
                          'Strengthen your weak skills with practical learning.',
                          'Build targeted projects that match role requirements.',
                          'Showcase your portfolio and apply consistently.',
                        ]).map((step, index) => (
                      <li key={`${career.id}-path-${index}`} className="text-xs text-blue-800">{step}</li>
                    ))}
                  </ol>
                </div>
              )}

              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setOpenSuggestionCard((current) => (current === career.id ? null : career.id));
                }}
                className="mt-4 w-full py-2 rounded-lg border border-gray-300 hover:bg-gray-50 text-sm font-semibold text-gray-700 transition"
              >
                {career.detailsAvailable === false
                  ? (openSuggestionCard === career.id ? 'Hide AI Suggestion' : 'AI Suggestion')
                  : 'View Details →'}
              </button>
            </div>
          );})}
        </div>
      </section>

      {/* Skills Summary */}
      {skills.length > 0 && (
        <section className="card-surface p-6">
          <h3 className="font-bold text-gray-900 mb-4">Your Skills</h3>
          <div className="flex flex-wrap gap-2">
            {skills.map((skill) => (
              <span key={skill} className="tag">{skill}</span>
            ))}
          </div>
        </section>
      )}

      {/* Topic-wise Scores */}
      {topicWiseScores.length > 0 && (
        <section className="card-surface p-6">
          <h3 className="font-bold text-gray-900 mb-1">Topic-wise Skill Scores</h3>
          <p className="text-sm text-gray-600 mb-4">
            Combined from skill assessment baseline and adaptive quiz performance.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {topicWiseScores.map((item) => (
              <div key={item.topic} className="rounded-lg border border-blue-100 bg-white/80 p-3">
                <p className="text-sm font-semibold text-gray-800">{item.topic}</p>
                <div className="mt-2 progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${item.score}%` }}
                  />
                </div>
                <p className="mt-2 text-sm font-bold text-blue-700">{item.score}%</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* What If Simulation */}
      <section className="bg-white rounded-xl shadow-md p-6">
        <div className="mb-4">
          <h3 className="text-xl font-bold text-gray-900">What If You Improve?</h3>
          <p className="text-sm text-gray-600 mt-1">
            Simulate how improving one skill can change your career outcomes.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="md:col-span-2">
            <label htmlFor="skill-simulation" className="block text-sm font-semibold text-gray-700 mb-2">
              Select Skill
            </label>
            <select
              id="skill-simulation"
              value={selectedSkill}
              onChange={(e) => setSelectedSkill(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Choose a skill</option>
              {skillOptions.map((skill) => (
                <option key={skill} value={skill}>
                  {skill}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleSimulate}
            disabled={simulating || skillOptions.length === 0}
            className="w-full rounded-lg bg-blue-600 text-white px-4 py-2 font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {simulating ? 'Simulating...' : 'Simulate'}
          </button>
        </div>

        {simulationError && (
          <p className="mt-4 text-sm text-red-600">{simulationError}</p>
        )}

        {simulationResult && (
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="text-xs font-semibold text-gray-500">OLD MATCH %</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{simulationResult.old_match_percentage}%</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="text-xs font-semibold text-gray-500">NEW MATCH %</p>
              <p className="text-2xl font-bold text-blue-700 mt-1">{simulationResult.new_match_percentage}%</p>
            </div>
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <p className="text-xs font-semibold text-green-700">IMPROVEMENT %</p>
              <p className="text-2xl font-bold text-green-700 mt-1">+{simulationResult.improvement_percentage}%</p>
            </div>

            <div className="sm:col-span-3 rounded-lg border border-gray-200 p-4">
              <p className="text-xs font-semibold text-gray-500 mb-2">NEW POSSIBLE JOB ROLES</p>
              {simulationResult.new_possible_job_roles?.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {simulationResult.new_possible_job_roles.map((role) => (
                    <span key={role} className="rounded-full border border-green-200 bg-green-50 px-3 py-1 text-sm text-green-700">
                      {role}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-600">
                  No additional roles unlocked yet. Keep improving for bigger jumps.
                </p>
              )}
            </div>

            <div className="sm:col-span-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <p className="text-xs font-semibold text-blue-700 mb-3">TOP SIMULATED CAREERS</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {(simulationResult.top_matches_after_simulation || []).slice(0, 3).map((career) => (
                  <div key={career.id} className="rounded-lg bg-white border border-blue-100 p-3">
                    <p className="text-sm font-bold text-gray-900">{career.name}</p>
                    <p className="text-xs text-gray-500 mt-1">Projected Match</p>
                    <p className="text-lg font-bold text-blue-700 mt-1">{career.score}%</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          type="button"
          className="btn-secondary flex-1"
          onClick={() => navigate('/skills')}
        >
          ← Retake Assessment
        </button>
        <button
          type="button"
          className="btn-primary flex-1"
          onClick={() => navigate('/')}
        >
          Back to Home
        </button>
      </div>
    </div>
  );
};

export default Results;

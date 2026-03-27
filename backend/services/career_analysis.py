"""Career analysis service: backend metrics + Groq enrichment."""

import json
import os
import random
import re
from typing import Any, Dict, List, Tuple

import requests

# Related-skill expansion so partial/nearby skills still contribute dynamically.
# Example: Deep Learning should inform ML/Data roles even if exact labels differ.
RELATED_SKILL_WEIGHTS: Dict[str, Dict[str, float]] = {
    "deep learning": {
        "Machine Learning": 0.9,
        "TensorFlow": 0.85,
        "Python": 0.5,
        "Statistics": 0.35,
    },
    "machine learning": {
        "Deep Learning": 0.9,
        "TensorFlow": 0.8,
        "Python": 0.55,
        "Statistics": 0.45,
    },
    "data analysis": {
        "SQL": 0.75,
        "Excel": 0.7,
        "Visualization": 0.7,
        "Statistics": 0.5,
    },
    "backend": {
        "Node.js": 0.8,
        "APIs": 0.8,
        "Databases": 0.65,
    },
    "cloud": {
        "AWS": 0.85,
        "Docker": 0.7,
        "Kubernetes": 0.7,
        "Deployment": 0.7,
    },
    "devops": {
        "Docker": 0.85,
        "Kubernetes": 0.85,
        "CI/CD": 0.9,
        "Linux": 0.65,
        "Deployment": 0.75,
    },
    "figma": {
        "UI Design": 0.9,
        "Wireframing": 0.85,
        "Prototyping": 0.85,
        "Design Systems": 0.75,
    },
    "user research": {
        "UX Research": 0.95,
        "Usability Testing": 0.9,
        "User Journey Mapping": 0.8,
        "Design Thinking": 0.75,
    },
    "design thinking": {
        "UX Research": 0.75,
        "Product Strategy": 0.8,
        "User Journey Mapping": 0.75,
        "Wireframing": 0.6,
    },
    "prototyping": {
        "Figma": 0.85,
        "Wireframing": 0.8,
        "UI Design": 0.75,
    },
}

# All careers mapped by domain
CAREERS_BY_DOMAIN = {
    "Cybersecurity & Cloud": {
        "Cloud Engineer": ["AWS", "Docker", "Kubernetes"],
        "Security Engineer": ["Linux", "Networking", "Security"],
        "DevOps Engineer": ["Docker", "Kubernetes", "Linux", "CI/CD"],
    },
    "Web & Mobile Development": {
        "Backend Developer": ["Node.js", "Databases", "APIs"],
        "Frontend Developer": ["React", "JavaScript", "HTML/CSS"],
        "Full Stack Developer": ["Node.js", "React", "Databases"],
        "MERN Stack Developer": ["MongoDB", "Express", "React", "Node.js"],
    },
    "Data Science & Analytics": {
        "Data Scientist": ["Python", "Machine Learning", "SQL", "Statistics"],
        "Data Analyst": ["SQL", "Excel", "Visualization"],
        "ML Engineer": ["Python", "TensorFlow", "APIs", "Deployment"],
    },
    "Artificial Intelligence & ML": {
        "ML Engineer": ["Python", "TensorFlow", "APIs", "Deployment"],
        "AI Engineer": ["Python", "Deep Learning", "NLP"],
        "Data Scientist": ["Python", "Machine Learning", "SQL", "Statistics"],
    },
    "Product & UX": {
        "UI/UX Designer": ["Figma", "Wireframing", "Prototyping", "UI Design"],
        "UX Researcher": ["UX Research", "User Research", "Usability Testing", "User Journey Mapping"],
        "Product Designer": ["Design Thinking", "Figma", "Prototyping", "Product Strategy"],
        "Product Manager": ["Product Strategy", "User Research", "Analytics", "Communication"],
    },
}

DOMAIN_ALIASES: Dict[str, List[str]] = {
    "Cybersecurity & Cloud": [
        "cybersecurity and cloud",
        "cyber security and cloud",
        "cybersecurity cloud",
        "cloud and security",
        "cloud security",
    ],
    "Web & Mobile Development": [
        "web and mobile development",
        "web mobile development",
        "web development",
        "mobile development",
        "full stack",
        "frontend and backend",
    ],
    "Data Science & Analytics": [
        "data science and analytics",
        "data science",
        "analytics",
        "data analytics",
    ],
    "Artificial Intelligence & ML": [
        "artificial intelligence and ml",
        "artificial intelligence",
        "ai and ml",
        "ai ml",
        "machine learning",
    ],
    "Product & UX": [
        "product and ux",
        "product ux",
        "product design and ux",
        "ui ux",
        "ux and product",
        "product management and ux",
    ],
}


def _normalize_domain_key(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", " ", str(value).strip().lower())
    return re.sub(r"\s+", " ", normalized).strip()


def _resolve_domain_name(domain: str) -> str:
    domain_clean = str(domain).strip() if domain else ""
    if not domain_clean:
        return "Web & Mobile Development"

    if domain_clean in CAREERS_BY_DOMAIN:
        return domain_clean

    normalized_input = _normalize_domain_key(domain_clean)
    for canonical, aliases in DOMAIN_ALIASES.items():
        candidates = [canonical, *aliases]
        if normalized_input in {_normalize_domain_key(item) for item in candidates}:
            return canonical

    return "Web & Mobile Development"

def _get_careers_for_domain(domain: str) -> Dict[str, List[str]]:
    """Get only careers relevant to the selected domain."""
    resolved_domain = _resolve_domain_name(domain)
    return CAREERS_BY_DOMAIN.get(resolved_domain, CAREERS_BY_DOMAIN["Web & Mobile Development"])


def _normalize_input_skills(skills: Dict[str, Any]) -> Dict[str, float]:
    normalized: Dict[str, float] = {}
    for key, value in (skills or {}).items():
        skill = str(key).strip()
        if not skill:
            continue
        try:
            score = float(value)
        except (TypeError, ValueError):
            score = 0.0
        score = max(0.0, min(10.0, score))
        normalized[skill] = score

    # Expand to related skills with weighted transfer so API remains dynamic
    # even when user-provided label differs from role-required label.
    expanded = dict(normalized)
    for skill, score in normalized.items():
        related = RELATED_SKILL_WEIGHTS.get(skill.strip().lower(), {})
        for target_skill, weight in related.items():
            inferred = max(0.0, min(10.0, score * float(weight)))
            existing = expanded.get(target_skill, 0.0)
            if inferred > existing:
                expanded[target_skill] = inferred

    return expanded


def _calculate_metrics(user_skills: Dict[str, float], required_skills: List[str]) -> Dict[str, Any]:
    if not required_skills:
        return {
            "match": 0,
            "domain_gap": 100,
            "tech_gap": 100,
            "missing_skills": [],
            "matched_skills": [],
        }

    required_count = len(required_skills)
    accumulated = 0.0
    matched_skills: List[str] = []
    missing_with_scores: List[Tuple[str, float]] = []

    for skill in required_skills:
        score = float(user_skills.get(skill, 0.0))
        accumulated += score

        if score >= 6.0:
            matched_skills.append(skill)
        else:
            missing_with_scores.append((skill, score))

    # Exact requested formula: (sum required skill scores / (10 * total_required)) * 100
    match = round((accumulated / (10.0 * required_count)) * 100.0)
    domain_gap = max(0, 100 - match)
    # Exact requested formula: (missing_count / total_required) * 100
    tech_gap = round((len(missing_with_scores) / required_count) * 100.0)

    # Variation rule: sort missing skills by lowest score first.
    missing_with_scores.sort(key=lambda item: item[1])
    missing_skills = [skill for skill, _ in missing_with_scores]

    weak_with_scores = [(skill, score) for skill, score in missing_with_scores if score < 5.0]
    weak_skills = [skill for skill, _ in weak_with_scores]

    return {
        "match": int(match),
        "domain_gap": int(domain_gap),
        "tech_gap": int(tech_gap),
        "missing_skills": missing_skills,
        "matched_skills": matched_skills,
        "weak_skills": weak_skills,
        "missing_with_scores": missing_with_scores,
        "weak_with_scores": weak_with_scores,
    }


def _groq_config() -> Dict[str, str]:
    api_key = os.getenv("GROQ_CAREER_API_KEY", os.getenv("GROQ_API_KEY", "")).strip()
    model = os.getenv("GROQ_CAREER_MODEL", os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")).strip() or "llama-3.1-8b-instant"
    api_url = "https://api.groq.com/openai/v1/chat/completions"
    return {"api_key": api_key, "model": model, "api_url": api_url}


def _extract_json_object(raw_text: str) -> str:
    start = raw_text.find("{")
    end = raw_text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("No JSON object found")
    return raw_text[start : end + 1]


def _extract_generated_text(payload: Any) -> str:
    if not isinstance(payload, dict):
        raise ValueError("Unexpected Groq response")

    choices = payload.get("choices", [])
    if not isinstance(choices, list) or not choices:
        raise ValueError("Groq response has no choices")

    first = choices[0]
    if not isinstance(first, dict):
        raise ValueError("Invalid choice format")

    message = first.get("message", {})
    if isinstance(message, dict) and "content" in message:
        return str(message["content"])
    if "text" in first:
        return str(first["text"])
    raise ValueError("No text in Groq response")


def _tools_for_skill(skill: str) -> List[str]:
    key = skill.strip().lower()
    mapping = {
        "python": ["Pandas", "NumPy", "Jupyter"],
        "sql": ["PostgreSQL", "MySQL", "SQLBolt"],
        "machine learning": ["scikit-learn", "TensorFlow", "PyTorch"],
        "tensorflow": ["TensorFlow", "Keras", "TensorBoard"],
        "apis": ["FastAPI", "Postman", "Swagger"],
        "deployment": ["Docker", "GitHub Actions", "Render"],
        "databases": ["PostgreSQL", "MongoDB", "Redis"],
        "node.js": ["Node.js", "Express", "NPM"],
        "excel": ["Excel", "Power Query", "Pivot Tables"],
        "visualization": ["Power BI", "Tableau", "Matplotlib"],
        "statistics": ["SciPy", "Statsmodels", "Khan Academy Stats"],
    }
    return mapping.get(skill.strip().lower(), ["Coursera", "YouTube", "GitHub Projects"])


def _fallback_llm_output(missing_with_scores: List[Tuple[str, float]], weak_with_scores: List[Tuple[str, float]], role: str, match: int) -> Dict[str, Any]:
    focus = weak_with_scores if weak_with_scores else missing_with_scores

    if focus:
        priority_skill = focus[0][0]
        secondary_skill = focus[1][0] if len(focus) > 1 else None
        recommendations = [
            f"Prioritize {priority_skill} first because it is one of your lowest scoring required skills.",
            f"Practice {priority_skill} in a small {role} project before moving to advanced topics.",
        ]
        if secondary_skill:
            recommendations.append(f"After {priority_skill}, strengthen {secondary_skill} to improve your match faster.")
    else:
        recommendations = [
            "You already cover core requirements; focus on advanced projects and interview depth.",
            f"Build 2 end-to-end {role} portfolio projects to stand out.",
        ]

    tools: List[str] = []
    for skill, _ in focus[:2]:
        tools.extend(_tools_for_skill(skill))
    if not tools:
        tools = ["GitHub", "LeetCode", "Kaggle"]

    deduped_tools: List[str] = []
    for tool in tools:
        if tool not in deduped_tools:
            deduped_tools.append(tool)

    scope_line = (
        "High demand and long-term growth in data-driven and product-focused teams."
        if role in {"Data Scientist", "ML Engineer", "Data Analyst"}
        else "Steady demand with strong opportunities in modern software teams."
    )

    explanation = (
        f"Your current match for {role} is {match}%. "
        + (
            f"Improving {focus[0][0]} will create the biggest jump in your fit."
            if focus
            else "You have strong baseline alignment and can focus on role specialization."
        )
    )

    return {
        "explanation": explanation,
        "tech_recommendations": recommendations,
        "tools": deduped_tools[:4],
        "future_scope": scope_line,
    }


def _call_groq_for_role(
    user_skills: Dict[str, float],
    role: str,
    match: int,
    missing_skills: List[str],
    weak_skills: List[str],
    missing_with_scores: List[Tuple[str, float]],
    weak_with_scores: List[Tuple[str, float]],
) -> Tuple[Dict[str, Any], str]:
    groq = _groq_config()
    if not groq["api_key"]:
        return _fallback_llm_output(missing_with_scores, weak_with_scores, role, match), "fallback"

    skill_text = ", ".join(f"{name} ({int(score) if score.is_integer() else round(score, 1)})" for name, score in user_skills.items())
    missing_text = ", ".join(missing_skills) if missing_skills else "None"
    weak_text = ", ".join(weak_skills) if weak_skills else "None"
    analysis_token = random.randint(1000, 9999)

    prompt = (
        "You are an AI career advisor.\n\n"
        f"Analysis ID: {analysis_token}\n"
        f"User Skills:\n{skill_text}\n\n"
        f"For the role {role}:\n"
        f"Match: {match}%\n"
        f"Missing Skills: {missing_text}\n\n"
        f"Weak Skills (score < 5): {weak_text}\n\n"
        "Generate:\n"
        "- Personalized explanation based on weak areas\n"
        "- Specific tech to learn (VERY IMPORTANT)\n"
        "- Example tools (Pandas, NumPy, TensorFlow etc.)\n"
        "- 2 line future scope\n\n"
        "Return JSON:\n"
        "{\n"
        '  "explanation": "",\n'
        '  "tech_recommendations": [],\n'
        '  "tools": [],\n'
        '  "future_scope": ""\n'
        "}\n"
    )

    try:
        body = json.dumps(
            {
                "model": groq["model"],
                "messages": [
                    {"role": "system", "content": "Return valid JSON only."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.2,
                "max_tokens": 500,
            }
        )

        response = requests.post(
            groq["api_url"],
            headers={
                "Authorization": f"Bearer {groq['api_key']}",
                "Content-Type": "application/json",
            },
            json=json.loads(body),
            timeout=20,
        )

        if response.status_code != 200:
            raise requests.HTTPError(f"HTTP {response.status_code}", response=response)

        payload = response.json()
        raw = _extract_generated_text(payload).strip()
        parsed = json.loads(_extract_json_object(raw))

        llm_output = {
            "explanation": str(parsed.get("explanation", "")).strip(),
            "tech_recommendations": [str(item).strip() for item in parsed.get("tech_recommendations", []) if str(item).strip()],
            "tools": [str(item).strip() for item in parsed.get("tools", []) if str(item).strip()],
            "future_scope": str(parsed.get("future_scope", "")).strip(),
        }

        if not llm_output["explanation"]:
            llm_output["explanation"] = _fallback_llm_output(missing_with_scores, weak_with_scores, role, match)["explanation"]

        return llm_output, "groq"
    except (requests.HTTPError, ValueError, json.JSONDecodeError, requests.Timeout):
        return _fallback_llm_output(missing_with_scores, weak_with_scores, role, match), "fallback"
    except Exception:
        return _fallback_llm_output(missing_with_scores, weak_with_scores, role, match), "fallback"


def analyze_careers(skills: Dict[str, Any], domain: str = "general") -> Dict[str, Any]:
    normalized_skills = _normalize_input_skills(skills)
    if not normalized_skills:
        raise ValueError("skills must be a non-empty object")

    print(f"[career-analysis] incoming_skills={normalized_skills}, domain={domain}")

    analyses: List[Dict[str, Any]] = []
    sources: List[str] = []

    # Get domain-relevant careers (filter by domain)
    domain_careers = _get_careers_for_domain(domain)
    
    # Dynamically compare user skills against ONLY domain-relevant careers
    for role, required in domain_careers.items():
        metrics = _calculate_metrics(normalized_skills, required)

        print(
            "[career-analysis] "
            f"role={role} match={metrics['match']} "
            f"missing={metrics['missing_skills']}"
        )

        llm_output, source = _call_groq_for_role(
            user_skills=normalized_skills,
            role=role,
            match=metrics["match"],
            missing_skills=metrics["missing_skills"],
            weak_skills=metrics["weak_skills"],
            missing_with_scores=metrics["missing_with_scores"],
            weak_with_scores=metrics["weak_with_scores"],
        )
        sources.append(source)

        analyses.append(
            {
                "title": role,
                "match": metrics["match"],
                "domain_gap": metrics["domain_gap"],
                "tech_gap": metrics["tech_gap"],
                "missing_skills": metrics["missing_skills"],
                "matched_skills": metrics["matched_skills"],
                "llm_output": llm_output,
            }
        )

    analyses.sort(key=lambda item: item.get("match", 0), reverse=True)

    overall_source = "groq" if sources and all(item == "groq" for item in sources) else "fallback"

    return {
        "careers": analyses,
        "source": overall_source,
    }

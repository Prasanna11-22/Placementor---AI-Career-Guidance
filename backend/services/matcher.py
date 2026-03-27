import json
import os
import re
from difflib import SequenceMatcher
from services.career_analysis import CAREERS_BY_DOMAIN, _calculate_metrics, _get_careers_for_domain, _normalize_input_skills

# Load careers data from JSON file
def _load_careers():
    """Load careers from JSON file"""
    try:
        with open('data/careers.json', 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return []

CAREERS_DB = _load_careers()


def _tokenize_skill_label(label):
    return {
        token
        for token in re.split(r'[^a-z0-9]+', str(label).strip().lower())
        if token
    }


def _skill_similarity(left, right):
    left_str = str(left).strip().lower()
    right_str = str(right).strip().lower()
    if not left_str or not right_str:
        return 0.0

    left_tokens = _tokenize_skill_label(left_str)
    right_tokens = _tokenize_skill_label(right_str)

    token_overlap = 0.0
    if left_tokens and right_tokens:
        token_overlap = len(left_tokens & right_tokens) / max(len(left_tokens), len(right_tokens))

    text_similarity = SequenceMatcher(None, left_str, right_str).ratio()
    return max(token_overlap, text_similarity * 0.6)

def find_matching_careers(skills, interests, assessment):
    """
    Find careers matching user's skills, interests, and assessment
    
    Args:
        skills: List of user skills
        interests: List of user interests
        assessment: Assessment results dictionary
    
    Returns:
        List of matched careers sorted by compatibility score
    """
    matched_careers = []
    
    for career in CAREERS_DB:
        score = calculate_compatibility_score(
            {'skills': skills, 'interests': interests},
            career
        )
        
        if score >= 40:  # Minimum threshold
            matched_careers.append({
                'id': career.get('id'),
                'name': career.get('name'),
                'compatibility_score': score,
                'match_percentage': f"{score}%"
            })
    
    # Sort by compatibility score (descending)
    matched_careers.sort(key=lambda x: x['compatibility_score'], reverse=True)
    
    return matched_careers

def get_career_details(career_id):
    """
    Get detailed information about a specific career
    
    Args:
        career_id: Career ID
    
    Returns:
        Career details dictionary or None
    """
    for career in CAREERS_DB:
        if career.get('id') == career_id:
            return {
                'id': career.get('id'),
                'name': career.get('name'),
                'description': career.get('description'),
                'required_skills': career.get('required_skills', []),
                'required_education': career.get('required_education'),
                'average_salary': career.get('average_salary'),
                'job_outlook': career.get('job_outlook'),
                'work_environment': career.get('work_environment'),
                'pros': career.get('pros', []),
                'cons': career.get('cons', [])
            }
    return None

def calculate_compatibility_score(user_profile, career):
    """
    Calculate compatibility score between user profile and a career
    
    Args:
        user_profile: User profile dictionary with skills and interests
        career: Career object (or career_id string)
    
    Returns:
        Compatibility score (0-100)
    """
    if isinstance(career, str):
        # If career_id is passed, fetch the career
        career = next((c for c in CAREERS_DB if c.get('id') == career), None)
        if not career:
            return 0
    
    user_skills = [s.lower() for s in user_profile.get('skills', [])]
    user_interests = [i.lower() for i in user_profile.get('interests', [])]
    
    career_skills = [s.lower() for s in career.get('required_skills', [])]
    career_interests = career.get('related_interests', [])
    career_interests = [i.lower() for i in career_interests]
    
    # Calculate skill match
    skill_match = 0
    if career_skills:
        skill_overlap = len(set(user_skills) & set(career_skills))
        skill_match = (skill_overlap / len(career_skills)) * 100
    
    # Calculate interest match
    interest_match = 0
    if career_interests:
        interest_overlap = len(set(user_interests) & set(career_interests))
        interest_match = (interest_overlap / len(career_interests)) * 100
    
    # Weighted average (70% skills, 30% interests)
    compatibility_score = (skill_match * 0.7) + (interest_match * 0.3)
    
    return round(compatibility_score, 2)

def get_career_path_recommendations(current_career_id):
    """
    Get recommended career advancement paths from current career
    
    Args:
        current_career_id: Current career ID
    
    Returns:
        List of recommended next careers
    """
    current_career = next((c for c in CAREERS_DB if c.get('id') == current_career_id), None)
    if not current_career:
        return []
    
    current_skills = set(s.lower() for s in current_career.get('required_skills', []))
    
    recommendations = []
    for career in CAREERS_DB:
        if career.get('id') != current_career_id:
            career_skills = set(s.lower() for s in career.get('required_skills', []))
            skill_overlap = len(current_skills & career_skills)
            
            if skill_overlap >= len(current_skills) * 0.6:  # At least 60% skill overlap
                recommendations.append({
                    'id': career.get('id'),
                    'name': career.get('name'),
                    'overlapping_skills': list(current_skills & career_skills),
                    'new_skills_needed': list(career_skills - current_skills)
                })
    
    return recommendations

def filter_careers_by_salary_range(min_salary, max_salary):
    """
    Filter careers by salary range
    
    Args:
        min_salary: Minimum salary
        max_salary: Maximum salary
    
    Returns:
        List of careers within salary range
    """
    filtered = []
    for career in CAREERS_DB:
        avg_salary = career.get('average_salary', 0)
        if min_salary <= avg_salary <= max_salary:
            filtered.append({
                'id': career.get('id'),
                'name': career.get('name'),
                'average_salary': avg_salary
            })
    
    return filtered


def simulate_skill_improvement(selected_skill, current_scores, interests=None, increase_by=20, domain=None):
    """
    Simulate improving one skill and estimate career match improvement.

    Args:
        selected_skill: Skill name selected by user
        current_scores: Dict like {"Python": 60, "SQL": 45}
        interests: Optional list of interests
        increase_by: Improvement amount for selected skill (default 20)

    Returns:
        Dict with old/new match %, improvement %, and new possible roles
    """
    if not selected_skill:
        raise ValueError("selected_skill is required")

    if not isinstance(current_scores, dict) or not current_scores:
        raise ValueError("current_scores must be a non-empty object")

    # Keep original skill names so they align with career requirements.
    normalized_scores_100 = {
        str(skill).strip(): max(0.0, min(100.0, float(score)))
        for skill, score in current_scores.items()
        if str(skill).strip()
    }
    selected_key = str(selected_skill).strip()

    if selected_key not in normalized_scores_100:
        normalized_scores_100[selected_key] = 0.0

    improved_scores_100 = dict(normalized_scores_100)
    improved_scores_100[selected_key] = min(100.0, improved_scores_100[selected_key] + increase_by)

    # Convert 0-100 UI scores to 0-10 API scoring scale.
    old_scores_10 = {skill: score / 10.0 for skill, score in normalized_scores_100.items()}
    new_scores_10 = {skill: score / 10.0 for skill, score in improved_scores_100.items()}

    # Reuse the same expansion logic as career analysis for dynamic related-skill matching.
    expanded_old = _normalize_input_skills(old_scores_10)
    expanded_new = _normalize_input_skills(new_scores_10)

    # Prefer explicit domain, else try first interest value.
    domain_value = str(domain).strip() if domain else ""
    if not domain_value and interests:
        first_interest = str(interests[0]).strip()
        if first_interest:
            domain_value = first_interest

    def _score_careers(careers_map, old_skill_profile=None, new_skill_profile=None):
        old_profile = old_skill_profile if isinstance(old_skill_profile, dict) else expanded_old
        new_profile = new_skill_profile if isinstance(new_skill_profile, dict) else expanded_new
        old_local = []
        new_local = []
        for role_name, required_skills in careers_map.items():
            old_metrics = _calculate_metrics(old_profile, required_skills)
            new_metrics = _calculate_metrics(new_profile, required_skills)

            role_id = role_name.lower().replace(' ', '-').replace('/', '-')
            old_local.append({'id': role_id, 'name': role_name, 'score': old_metrics['match']})
            new_local.append({'id': role_id, 'name': role_name, 'score': new_metrics['match']})

        old_local.sort(key=lambda x: x['score'], reverse=True)
        new_local.sort(key=lambda x: x['score'], reverse=True)
        return old_local, new_local

    domain_careers = _get_careers_for_domain(domain_value)
    old_scores, new_scores = _score_careers(domain_careers)

    # If domain-restricted simulation is completely flat (all zeros),
    # fall back to all careers so users still get live, meaningful movement.
    domain_max_new = max((item['score'] for item in new_scores), default=0)
    if domain_max_new <= 0:
        all_careers = {}
        for careers_map in CAREERS_BY_DOMAIN.values():
            if isinstance(careers_map, dict):
                all_careers.update(careers_map)
        old_scores, new_scores = _score_careers(all_careers)

    # If simulation is still flat, infer required-skill scores from the user's
    # provided skill profile with fuzzy transfer to keep outcomes role-specific.
    global_max_new = max((item['score'] for item in new_scores), default=0)
    if global_max_new <= 0:
        all_careers = {}
        for careers_map in CAREERS_BY_DOMAIN.values():
            if isinstance(careers_map, dict):
                all_careers.update(careers_map)

        fallback_careers = domain_careers if domain_careers else all_careers

        all_required_skills = {
            skill
            for required_list in fallback_careers.values()
            for skill in required_list
        }

        required_frequency = {}
        for required_list in fallback_careers.values():
            for skill in required_list:
                required_frequency[skill] = required_frequency.get(skill, 0) + 1
        max_frequency = max(required_frequency.values(), default=1)

        def _build_transferred_profile(base_scores_10):
            source_items = [
                (str(skill).strip(), max(0.0, min(10.0, float(score))))
                for skill, score in base_scores_10.items()
                if str(skill).strip()
            ]

            avg_source = (
                sum(score for _, score in source_items) / len(source_items)
                if source_items else 0.0
            )

            inferred_profile = dict(base_scores_10)
            for required_skill in all_required_skills:
                current_value = max(0.0, min(10.0, float(inferred_profile.get(required_skill, 0.0))))
                best_transfer = 0.0

                for source_skill, source_value in source_items:
                    similarity = _skill_similarity(required_skill, source_skill)
                    best_transfer = max(best_transfer, source_value * similarity)

                frequency_ratio = required_frequency.get(required_skill, 1) / max_frequency
                baseline = min(1.6, max(0.15, avg_source * 0.08 + frequency_ratio * 0.25))
                inferred_value = min(10.0, max(current_value, baseline + (best_transfer * 0.85)))
                inferred_profile[required_skill] = inferred_value

            return _normalize_input_skills(inferred_profile)

        boosted_old_profile = _build_transferred_profile(old_scores_10)
        boosted_new_profile = _build_transferred_profile(new_scores_10)
        old_scores, new_scores = _score_careers(
            fallback_careers,
            old_skill_profile=boosted_old_profile,
            new_skill_profile=boosted_new_profile,
        )

    old_top = old_scores[0]['score'] if old_scores else 0
    new_top = new_scores[0]['score'] if new_scores else 0
    improvement = round(new_top - old_top, 2)

    old_role_ids = {item['id'] for item in old_scores if item['score'] >= 60}
    new_possible_roles = [
        item['name']
        for item in new_scores
        if item['score'] >= 50 and item['id'] not in old_role_ids
    ]

    return {
        'selected_skill': selected_skill,
        'domain': domain_value or 'Web & Mobile Development',
        'old_match_percentage': round(old_top, 2),
        'new_match_percentage': round(new_top, 2),
        'improvement_percentage': improvement,
        'new_possible_job_roles': new_possible_roles,
        'top_matches_after_simulation': new_scores[:5],
        'updated_scores': {
            skill: round(score, 2)
            for skill, score in improved_scores_100.items()
        },
    }

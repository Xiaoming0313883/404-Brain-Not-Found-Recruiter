from typing import Any, Dict


DEFAULT_BIAS_CONTROLS: Dict[str, Any] = {
    "neutralize_prestige": False,
    "anonymized_blind_hiring": False,
    "scoring_mode": "blind_merit",
    "prestige_weight": 30,
}


def normalize_bias_controls(value: Dict[str, Any] | None) -> Dict[str, Any]:
    controls = {**DEFAULT_BIAS_CONTROLS, **(value or {})}
    controls["neutralize_prestige"] = bool(controls.get("neutralize_prestige"))
    controls["anonymized_blind_hiring"] = bool(controls.get("anonymized_blind_hiring"))
    controls["scoring_mode"] = (
        "prestige_aware"
        if controls.get("scoring_mode") == "prestige_aware"
        else "blind_merit"
    )
    try:
        prestige_weight = int(controls.get("prestige_weight", DEFAULT_BIAS_CONTROLS["prestige_weight"]))
    except (TypeError, ValueError):
        prestige_weight = DEFAULT_BIAS_CONTROLS["prestige_weight"]
    controls["prestige_weight"] = max(0, min(50, prestige_weight))
    return controls


def get_bias_controls(db: Dict[str, Any]) -> Dict[str, Any]:
    settings = db.setdefault("settings", {})
    controls = normalize_bias_controls(settings.get("bias_controls"))
    settings["bias_controls"] = controls
    return controls


def update_bias_controls(db: Dict[str, Any], updates: Dict[str, Any]) -> Dict[str, Any]:
    settings = db.setdefault("settings", {})
    current = get_bias_controls(db)
    settings["bias_controls"] = normalize_bias_controls({**current, **updates})
    return settings["bias_controls"]

import pytest

from backend.pipeline.llm import route_model, MODEL_SONNET, MODEL_HAIKU
from backend.prompts import DAISY_PROMPT_EN, DAISY_PROMPT_ES, get_prompt


def test_route_haiku_when_no_image():
    assert route_model(has_image=False) == MODEL_HAIKU


def test_route_sonnet_when_image():
    assert route_model(has_image=True) == MODEL_SONNET


def test_get_prompt_en():
    assert get_prompt("en") == DAISY_PROMPT_EN


def test_get_prompt_es():
    assert get_prompt("es") == DAISY_PROMPT_ES

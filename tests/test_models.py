from __future__ import annotations
import pytest
from pydantic import ValidationError
from app.models import GenerateRequest

def test_prompt_is_trimmed():
    assert GenerateRequest(prompt="  hello  ").prompt == "hello"

def test_blank_prompt_rejected():
    with pytest.raises(ValidationError):
        GenerateRequest(prompt="   ")

def test_mode_validation():
    assert GenerateRequest(prompt="hello", mode="video").mode == "video"

from app.flow import normalize_text

def test_normalize_text():
    assert normalize_text("  a\n  b\t c ") == "a b c"

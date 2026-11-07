from app.schema import describe_schema


def test_schema_is_derived_from_the_data():
    s = describe_schema()
    assert "reference_date (latest visit): 2025-11-16 17:30:00" in s
    assert '$[*].items[*].question' in s and '"Service user involved"' in s
    assert 'status TEXT  -- values: "Completed"' in s
    assert "Care Plan — Alfred Nkemelu" in s

def test_nested_json_gets_an_unnest_hint():
    s = describe_schema()
    assert "json_each(t.form_data) j0, json_each(j0.value, '$.items') j1" in s

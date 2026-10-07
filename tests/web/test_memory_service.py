from __future__ import annotations


def test_target_memory_api_normalizes_domain_for_create_and_filter(monkeypatch, tmp_path):
    from vulnclaw.targets import target_experience_key
    import vulnclaw.web.services.memory_service as memory_service
    from vulnclaw.kb.experience import ExperienceStore

    store = ExperienceStore(tmp_path)
    monkeypatch.setattr(memory_service, "_store", store)

    created = memory_service.create_lesson(
        {
            "scope": "target",
            "target_key": "https://Example.com/",
            "signal": "deadend",
            "context": "The XSS candidate was disproved.",
            "lesson": "Require a differential response before retrying.",
        }
    )

    expected_key = target_experience_key("https://example.com/")
    assert created["target_key"] == expected_key
    assert [item["id"] for item in memory_service.list_lessons(target_key="example.com")] == [
        created["id"]
    ]
    assert memory_service.list_lessons(target_key=expected_key)[0]["target_key"] == expected_key


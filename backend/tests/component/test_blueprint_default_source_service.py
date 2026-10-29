"""Tests for default blueprint source seeding."""

from models import BlueprintSource, ModuleSource
from services.blueprint_default_source_service import (
    DEFAULT_CATALOG_BLUEPRINT_SOURCES,
    DEFAULT_CATALOG_MODULE_SOURCES,
    ensure_default_blueprint_source,
    ensure_default_catalog_blueprint_sources,
    ensure_default_catalog_module_sources,
    is_default_blueprint_source,
)
from services.defaults_service import seed_defaults, set_default


class TestEnsureDefaultBlueprintSource:
    def test_skips_when_git_url_not_configured(self, db):
        seed_defaults(db)
        result = ensure_default_blueprint_source(db)
        assert result is None

    def test_creates_source_when_configured(self, db):
        seed_defaults(db)
        set_default(db, "blueprint_library.git_url", "https://github.com/example/blueprints.git")
        set_default(db, "blueprint_library.git_ref", "main")
        db.commit()

        source = ensure_default_blueprint_source(db)

        assert source is not None
        assert source.url == "https://github.com/example/blueprints.git"
        assert source.branch == "main"
        assert source.git_ref == "main"
        assert source.name == "official-blueprints-blueprints"

    def test_reuses_existing_source_and_updates_ref(self, db):
        seed_defaults(db)
        set_default(db, "blueprint_library.git_url", "https://github.com/example/blueprints.git")
        set_default(db, "blueprint_library.git_ref", "main")
        db.commit()

        created = ensure_default_blueprint_source(db)

        set_default(db, "blueprint_library.git_ref", "release/2.3")
        db.commit()

        reused = ensure_default_blueprint_source(db)
        assert reused is not None
        assert reused.id == created.id
        assert reused.branch == "release/2.3"
        assert reused.git_ref == "release/2.3"

    def test_detects_default_source(self, db):
        seed_defaults(db)
        set_default(db, "blueprint_library.git_url", "https://github.com/example/blueprints.git")
        set_default(db, "blueprint_library.git_ref", "main")
        db.commit()

        source = ensure_default_blueprint_source(db)
        assert source is not None
        assert is_default_blueprint_source(source, db) is True


class TestEnsureDefaultCatalogSources:
    def test_creates_default_catalog_blueprint_sources_and_is_idempotent(self, db):
        sources = ensure_default_catalog_blueprint_sources(db)
        db.commit()

        assert len(sources) == len(DEFAULT_CATALOG_BLUEPRINT_SOURCES)
        names = {s.name for s in sources}
        assert names == {"bnk-forge-modules-shared", "bnk-forge-modules-aws-eks"}
        for s in sources:
            assert s.branch == "release/2.4.1"
            assert s.git_ref == "release/2.4.1"
            assert s.is_active is True

        # Second call is idempotent
        sources_again = ensure_default_catalog_blueprint_sources(db)
        assert [s.id for s in sources_again] == [s.id for s in sources]
        assert db.query(BlueprintSource).filter(BlueprintSource.source_type == "git").count() == 2

    def test_respects_deactivated_catalog_blueprint_source_and_matches_normalized_url(self, db):
        existing = BlueprintSource(
            name="custom-shared-name",
            source_type="git",
            url="https://github.com/JLCode-tech/bnk-forge-catalog-shared.git/",
            branch="",
            git_ref=None,
            sync_status="pending",
            is_active=False,
        )
        db.add(existing)
        db.commit()

        active_sources = ensure_default_catalog_blueprint_sources(db)
        db.commit()

        assert len(active_sources) == 1
        assert active_sources[0].name == "bnk-forge-modules-aws-eks"

        db.refresh(existing)
        assert existing.is_active is False
        assert existing.branch == "release/2.4.1"
        assert existing.git_ref == "release/2.4.1"
        assert db.query(BlueprintSource).filter(BlueprintSource.source_type == "git").count() == 2

    def test_creates_default_catalog_module_sources_and_is_idempotent(self, db):
        sources = ensure_default_catalog_module_sources(db)
        db.commit()

        assert len(sources) == len(DEFAULT_CATALOG_MODULE_SOURCES)
        names = {s.name for s in sources}
        assert names == {
            "bnk-forge-modules-aws-eks modules",
            "bnk-forge-modules-shared modules",
            "official-bnk-forge-modules",
        }
        for s in sources:
            assert s.branch == "release/2.4.1"
            assert s.git_ref == "release/2.4.1"
            assert s.is_active is True

        sources_again = ensure_default_catalog_module_sources(db)
        assert [s.id for s in sources_again] == [s.id for s in sources]
        assert db.query(ModuleSource).filter(ModuleSource.source_type == "git").count() == 3

    def test_migrates_legacy_release_2_2_on_existing_module_source_and_respects_deactivated(self, db):
        existing = ModuleSource(
            name="official-bnk-forge-modules",
            source_type="git",
            url="https://github.com/JLCode-tech/bnk-forge-modules.git",
            branch="release/2.2",
            git_ref="release/2.2",
            auth_type="none",
            credential_type="none",
            sync_status="success",
            is_active=False,
        )
        db.add(existing)
        db.commit()

        active_sources = ensure_default_catalog_module_sources(db)
        db.commit()

        assert len(active_sources) == 2
        db.refresh(existing)
        assert existing.is_active is False
        assert existing.branch == "release/2.4.1"
        assert existing.git_ref == "release/2.4.1"

"""Startup seeding for the default blueprint catalog source."""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from models import BlueprintSource, ModuleSource
from services.defaults_service import get_default, set_default
from services.git_auth_service import GitAuthService

logger = logging.getLogger(__name__)

DEFAULT_CATALOG_BLUEPRINT_SOURCES: tuple[dict[str, str], ...] = (
    {
        "name": "bnk-forge-modules-shared",
        "url": "https://github.com/JLCode-tech/bnk-forge-catalog-shared",
        "branch": "release/2.4.1",
        "git_ref": "release/2.4.1",
        "description": "Official shared BNK Forge blueprint and module catalog",
    },
    {
        "name": "bnk-forge-modules-aws-eks",
        "url": "https://github.com/JLCode-tech/bnk-forge-catalog-aws-eks.git",
        "branch": "release/2.4.1",
        "git_ref": "release/2.4.1",
        "description": "Official AWS EKS + F5 BNK blueprint and module catalog",
    },
)

DEFAULT_CATALOG_MODULE_SOURCES: tuple[dict[str, str], ...] = (
    {
        "name": "bnk-forge-modules-aws-eks modules",
        "url": "https://github.com/JLCode-tech/bnk-forge-catalog-aws-eks.git",
        "branch": "release/2.4.1",
        "git_ref": "release/2.4.1",
        "description": "Auto-created from blueprint source 'bnk-forge-modules-aws-eks'",
    },
    {
        "name": "bnk-forge-modules-shared modules",
        "url": "https://github.com/JLCode-tech/bnk-forge-catalog-shared",
        "branch": "release/2.4.1",
        "git_ref": "release/2.4.1",
        "description": "Auto-created from blueprint source 'bnk-forge-modules-shared'",
    },
    {
        "name": "official-bnk-forge-modules",
        "url": "https://github.com/JLCode-tech/bnk-forge-modules.git",
        "branch": "release/2.4.1",
        "git_ref": "release/2.4.1",
        "description": "Canonical official module catalog source",
    },
)


def _normalize_git_url(url: str | None) -> str:
    return GitAuthService.strip_url_credentials((url or "").strip()).rstrip("/").removesuffix(".git")


def _build_official_blueprint_source_name(repo_name: str) -> str:
    return f"official-{repo_name}-blueprints"


def ensure_default_blueprint_source(db: Session) -> BlueprintSource | None:
    """Create or update the canonical default blueprint source from system defaults."""
    git_url = get_default(db, "blueprint_library.git_url")
    git_ref = get_default(db, "blueprint_library.git_ref") or "main"

    if not git_url:
        logger.info("Default blueprint source not configured; skipping blueprint source seed")
        return None

    clean_url = str(git_url).strip()
    repo_name = clean_url.rstrip("/").split("/")[-1]
    if repo_name.endswith(".git"):
        repo_name = repo_name[:-4]

    existing = db.query(BlueprintSource).filter(
        BlueprintSource.source_type == "git",
        BlueprintSource.url == clean_url,
        BlueprintSource.is_active,
    ).first()
    if existing:
        existing.branch = git_ref
        existing.git_ref = git_ref
        existing.sync_error = None
        db.flush()
        return existing

    base_name = _build_official_blueprint_source_name(repo_name)
    candidate_name = base_name
    suffix = 2
    while db.query(BlueprintSource).filter(BlueprintSource.name == candidate_name).first() is not None:
        candidate_name = f"{base_name}-{suffix}"
        suffix += 1

    source = BlueprintSource(
        name=candidate_name,
        source_type="git",
        url=clean_url,
        branch=git_ref,
        git_ref=git_ref,
        sync_status="pending",
        sync_error=None,
        is_active=True,
        description="Canonical official blueprint catalog source",
    )
    db.add(source)
    db.flush()
    return source


def is_default_blueprint_source(source: BlueprintSource, db: Session) -> bool:
    """Whether the given source matches the configured canonical default blueprint source."""
    git_url = get_default(db, "blueprint_library.git_url")
    git_ref = get_default(db, "blueprint_library.git_ref") or "main"
    if not git_url:
        return False

    return (
        source.source_type == "git"
        and source.url == str(git_url).strip()
        and (source.git_ref or source.branch or "main") == git_ref
    )


def set_default_blueprint_source(source: BlueprintSource, db: Session) -> None:
    """Point system defaults at the selected blueprint source."""
    if source.source_type != "git":
        raise ValueError("Only git blueprint sources can be configured as default")

    git_ref = source.git_ref or source.branch or "main"
    set_default(db, "blueprint_library.git_url", source.url)
    set_default(db, "blueprint_library.git_ref", git_ref)


def ensure_default_catalog_blueprint_sources(db: Session) -> list[BlueprintSource]:
    """Ensure the canonical default external Blueprint Catalog sources exist."""
    existing_sources = (
        db.query(BlueprintSource)
        .filter(BlueprintSource.source_type == "git")
        .order_by(BlueprintSource.id.asc())
        .all()
    )
    active_sources: list[BlueprintSource] = []

    for spec in DEFAULT_CATALOG_BLUEPRINT_SOURCES:
        target_url = _normalize_git_url(spec["url"])
        matched = next(
            (
                row
                for row in existing_sources
                if _normalize_git_url(row.url) == target_url or row.name == spec["name"]
            ),
            None,
        )
        if matched is not None:
            if not (matched.branch or "").strip() or matched.branch == "release/2.2":
                matched.branch = spec["branch"]
            if not (matched.git_ref or "").strip() or matched.git_ref == "release/2.2":
                matched.git_ref = spec["git_ref"]
            db.flush()
            if matched.is_active:
                active_sources.append(matched)
            continue

        base_name = spec["name"]
        candidate_name = base_name
        suffix = 2
        while db.query(BlueprintSource).filter(BlueprintSource.name == candidate_name).first() is not None:
            candidate_name = f"{base_name}-{suffix}"
            suffix += 1

        created = BlueprintSource(
            name=candidate_name,
            source_type="git",
            url=spec["url"],
            branch=spec["branch"],
            git_ref=spec["git_ref"],
            sync_status="pending",
            sync_error=None,
            is_active=True,
            description=spec["description"],
        )
        db.add(created)
        db.flush()
        existing_sources.append(created)
        active_sources.append(created)

    return active_sources


def ensure_default_catalog_module_sources(db: Session) -> list[ModuleSource]:
    """Ensure the canonical default external Module Catalog sources exist."""
    existing_sources = (
        db.query(ModuleSource)
        .filter(ModuleSource.source_type == "git")
        .order_by(ModuleSource.id.asc())
        .all()
    )
    active_sources: list[ModuleSource] = []

    for spec in DEFAULT_CATALOG_MODULE_SOURCES:
        target_url = _normalize_git_url(spec["url"])
        matched = next(
            (
                row
                for row in existing_sources
                if _normalize_git_url(row.url) == target_url or row.name == spec["name"]
            ),
            None,
        )
        if matched is not None:
            if not (matched.branch or "").strip() or matched.branch == "release/2.2":
                matched.branch = spec["branch"]
            if not (matched.git_ref or "").strip() or matched.git_ref == "release/2.2":
                matched.git_ref = spec["git_ref"]
            db.flush()
            if matched.is_active:
                active_sources.append(matched)
            continue

        base_name = spec["name"]
        candidate_name = base_name
        suffix = 2
        while db.query(ModuleSource).filter(ModuleSource.name == candidate_name).first() is not None:
            candidate_name = f"{base_name}-{suffix}"
            suffix += 1

        created = ModuleSource(
            name=candidate_name,
            source_type="git",
            url=spec["url"],
            branch=spec["branch"],
            git_ref=spec["git_ref"],
            auth_type="none",
            credential_type="none",
            sync_status="pending",
            sync_error=None,
            is_active=True,
            description=spec["description"],
        )
        db.add(created)
        db.flush()
        existing_sources.append(created)
        active_sources.append(created)

    return active_sources

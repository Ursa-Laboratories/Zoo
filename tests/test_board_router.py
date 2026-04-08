"""Test board API endpoints against CubOS instrument registry APIs."""

from tests.api_client import api_request
from zoo.app import create_app


def test_list_instrument_types_uses_cubos_registry():
    app = create_app()

    response = api_request(app, "GET", "/api/board/instrument-types")

    assert response.status_code == 200
    names = {item["type"] for item in response.json()}
    assert {"pipette", "uvvis_ccs"}.issubset(names)


def test_get_instrument_schemas_uses_cubos_registry_classes():
    app = create_app()

    response = api_request(app, "GET", "/api/board/instrument-schemas")

    assert response.status_code == 200
    schemas = response.json()
    assert "pipette" in schemas
    pipette_fields = {field["name"]: field for field in schemas["pipette"]}
    assert "pipette_model" in pipette_fields
    assert "p300_single_gen2" in pipette_fields["pipette_model"]["choices"]

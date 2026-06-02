import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DeckVisualization from "./DeckVisualization";
import HolderRenderer from "./HolderRenderer";
import TipRackRenderer from "./TipRackRenderer";
import type { DeckResponse } from "../../types";

const deck: DeckResponse = {
  filename: "panda_deck.yaml",
  labware: [
    {
      key: "rack_a",
      config: {
        type: "tip_rack",
        name: "Rack A",
        model_name: "panda_2x2_tip_rack",
        rows: 2,
        columns: 2,
        z_pickup: 30,
        z_drop: 24,
        tips: {
          A1: { x: 10, y: 20, z: 30 },
          A2: { x: 19, y: 20, z: 30 },
          B1: { x: 10, y: 11, z: 30 },
          B2: { x: 19, y: 11, z: 30 },
        },
      },
      wells: null,
      location: { x: 10, y: 20, z: 30 },
      geometry: { length: 9, width: 9, height: 6 },
      positions: {
        A1: { x: 10, y: 20, z: 30 },
        A2: { x: 19, y: 20, z: 30 },
        B1: { x: 10, y: 11, z: 30 },
        B2: { x: 19, y: 11, z: 30 },
      },
    },
    {
      key: "well_plate_holder",
      config: {
        type: "well_plate_holder",
        name: "Plate Holder",
        location: { x: 100, y: 120, z: 40 },
        well_plate: {
          name: "Panda Plate",
          model_name: "panda_96_wellplate",
          rows: 2,
          columns: 2,
          calibration: {
            a1: { x: 100, y: 120, z: 45 },
            a2: { x: 109, y: 120, z: 45 },
          },
          x_offset: 9,
          y_offset: 9,
        },
      },
      wells: null,
      location: { x: 100, y: 120, z: 40 },
      geometry: { length: 100, width: 155, height: 14.8 },
      positions: {
        plate: { x: 100, y: 120, z: 45 },
        "plate.A1": { x: 100, y: 120, z: 45 },
        "plate.A2": { x: 109, y: 120, z: 45 },
        "plate.B1": { x: 100, y: 111, z: 45 },
        "plate.B2": { x: 109, y: 111, z: 45 },
      },
    },
    {
      key: "vial_holder",
      config: {
        type: "vial_holder",
        name: "Panda Vials",
        location: { x: 30, y: 60, z: 8 },
        vials: {
          vial_1: {
            name: "Sample 1",
            model_name: "20ml_vial",
            height: 57,
            diameter: 28,
            location: { x: 30, y: 60 },
            capacity_ul: 20000,
            working_volume_ul: 15000,
          },
        },
      },
      wells: null,
      location: { x: 30, y: 60, z: 8 },
      geometry: { length: 36.2, width: 300.2, height: 35.1 },
      positions: {
        vial_1: { x: 30, y: 60, z: 26 },
      },
    },
  ],
};

describe("DeckVisualization", () => {
  it("renders tip racks, holders, and nested holder labware", () => {
    render(
      <DeckVisualization
        deck={deck}
        instruments={null}
        gantryPosition={null}
        machineXRange={[0, 300]}
        machineYRange={[0, 200]}
      />,
    );

    expect(screen.getByText("Rack A")).toBeInTheDocument();
    expect(screen.getByText("Plate Holder")).toBeInTheDocument();
    expect(screen.getByText("Panda Plate")).toBeInTheDocument();
    expect(screen.getByText("Panda Vials")).toBeInTheDocument();
    expect(screen.getByText("Sample 1")).toBeInTheDocument();
  });

  it("keeps the coordinate scale fixed as the gantry moves", () => {
    render(
      <DeckVisualization
        deck={{ filename: "empty.yaml", labware: [] }}
        instruments={{ pipette: { type: "mock_pipette", vendor: "mock", offset_x: 40, offset_y: 0 } }}
        gantryPosition={{
          connected: true,
          status: "Idle",
          x: 490,
          y: 20,
          z: 0,
          work_x: 490,
          work_y: 20,
          work_z: 0,
        }}
        machineXRange={[0, 300]}
        machineYRange={[0, 400]}
      />,
    );

    expect(screen.getAllByText("300").length).toBeGreaterThan(0);
    expect(screen.getAllByText("350").length).toBeGreaterThan(0);
    expect(screen.queryByText("500")).not.toBeInTheDocument();
  });

  it("expands the visible range for labware wider than the working volume", () => {
    const wideDeck: DeckResponse = {
      filename: "wide_deck.yaml",
      labware: [
        {
          key: "wide_plate",
          config: {
            type: "well_plate",
            name: "Wide Plate",
            model_name: "wide_96_wellplate",
            rows: 1,
            columns: 2,
            length: 100,
            width: 50,
            height: 10,
            a1: null,
            calibration: {
              a1: { x: 250, y: 50, z: 10 },
              a2: { x: 330, y: 50, z: 10 },
            },
            x_offset: 80,
            y_offset: 9,
            capacity_ul: 200,
            working_volume_ul: 100,
          },
          wells: {
            A1: { x: 250, y: 50, z: 10 },
            A2: { x: 330, y: 50, z: 10 },
          },
        },
      ],
    };

    render(
      <DeckVisualization
        deck={wideDeck}
        instruments={null}
        gantryPosition={null}
        machineXRange={[0, 306]}
        machineYRange={[0, 300]}
      />,
    );

    expect(screen.getByText("Wide Plate")).toBeInTheDocument();
    expect(screen.getByText("350")).toBeInTheDocument();
  });

  it("renders holder labware with current CubOS dimension keys without NaN attributes", () => {
    const currentDeck: DeckResponse = {
      filename: "current_holder.yaml",
      labware: [
        {
          key: "plate_holder",
          config: {
            type: "well_plate_holder",
            name: "Current Plate Holder",
            location: { x: 100, y: 100, z: 10 },
            well_plate: {
              name: "Current Plate",
              model_name: "current_plate",
              rows: 2,
              columns: 2,
              calibration: {
                a1: { x: 100, y: 100 },
                a2: { x: 109, y: 100 },
              },
              length: 127.76,
              width: 85.47,
              height: 14.22,
              x_offset: 9,
              y_offset: 9,
            },
          },
          wells: null,
          location: { x: 100, y: 100, z: 10 },
          geometry: { length: 100, width: 155, height: 14.8 },
          positions: {
            "plate.A1": { x: 100, y: 100, z: 15 },
            "plate.A2": { x: 109, y: 100, z: 15 },
            "plate.B1": { x: 100, y: 91, z: 15 },
            "plate.B2": { x: 109, y: 91, z: 15 },
          },
        },
        {
          key: "vial_holder",
          config: {
            type: "vial_holder",
            name: "Current Vials",
            location: { x: 30, y: 60, z: 8 },
            vials: {
              vial_1: {
                name: "Current Vial",
                model_name: "20ml_vial",
                height: 57,
                diameter: 28,
                location: { x: 30, y: 60 },
                capacity_ul: 20000,
                working_volume_ul: 15000,
              },
            },
          },
          wells: null,
          location: { x: 30, y: 60, z: 8 },
          geometry: { length: 36.2, width: 300.2, height: 35.1 },
          positions: {
            vial_1: { x: 30, y: 60, z: 26 },
          },
        },
      ],
    };

    render(
      <DeckVisualization
        deck={currentDeck}
        instruments={null}
        gantryPosition={null}
        machineXRange={[0, 300]}
        machineYRange={[0, 200]}
      />,
    );

    expect(screen.getByText("Current Plate")).toBeInTheDocument();
    expect(screen.getByText("Current Vial")).toBeInTheDocument();
    expect(screen.getByTestId("deck-visualization").outerHTML).not.toContain("NaN");
  });

  it("renders bed-mode motion, direct vials, and filtered rack positions", () => {
    const bedDeck: DeckResponse = {
      filename: "bed_deck.yaml",
      labware: [
        {
          key: "loose_vial",
          config: {
            type: "vial",
            name: "Loose Vial",
            model_name: "loose_vial",
            height: 20,
            diameter: 10,
            location: { x: 20, y: 30, z: 5 },
            capacity_ul: 1000,
            working_volume_ul: 800,
          },
          wells: null,
        },
        {
          key: "empty_holder",
          config: {
            type: "well_plate_holder",
            name: "Empty Holder",
            location: { x: 250, y: 180, z: 0 },
            well_plate: null,
          },
          wells: null,
          location: { x: 250, y: 180, z: 0 },
          geometry: { length: null, width: null, height: null },
          positions: {},
        },
        {
          key: "filtered_rack",
          config: {
            type: "tip_rack",
            name: "Filtered Rack",
            model_name: "filtered_tip_rack",
            rows: 1,
            columns: 1,
            z_pickup: 30,
            z_drop: 24,
            tips: {
              A1: { x: 40, y: 50, z: 0 },
            },
          },
          wells: null,
          positions: {
            location: { x: 999, y: 999, z: 0 },
            "tip.A1": { x: 998, y: 998, z: 0 },
            A1: { x: 40, y: 50, z: 0 },
          },
        },
      ],
    };

    render(
      <DeckVisualization
        deck={bedDeck}
        instruments={{
          probe: {
            type: "mock_probe",
            vendor: "mock",
            offset_x: -25,
            offset_y: 35,
          },
        }}
        gantryPosition={{
          connected: true,
          status: "Idle",
          x: 100,
          y: 50,
          z: 0,
          work_x: 100,
          work_y: 50,
          work_z: 0,
        }}
        machineXRange={[0, 300]}
        machineYRange={[0, 200]}
        yAxisMotion="bed"
      />,
    );

    const svg = screen.getByTestId("deck-visualization");
    expect(screen.getByText("bed moves Y")).toBeInTheDocument();
    expect(screen.getByText("Loose Vial")).toBeInTheDocument();
    expect(screen.getByText("Empty Holder")).toBeInTheDocument();
    expect(screen.getByText("Filtered Rack")).toBeInTheDocument();
    expect(screen.getByText("probe")).toBeInTheDocument();
    expect(svg.querySelector('g[transform^="translate"]')).toBeInTheDocument();
    expect(svg.outerHTML).not.toContain("tip.A1");
    expect(svg.outerHTML).not.toContain("998");
  });

  it("skips missing vial positions, unsupported labware, and incomplete holders", () => {
    const edgeDeck = {
      filename: "edge_deck.yaml",
      labware: [
        {
          key: "missing_vial_holder",
          config: {
            type: "vial_holder",
            name: "Missing Vials",
            location: { x: 10, y: 10, z: 0 },
            vials: {
              absent: {
                name: "Absent Vial",
                model_name: "vial",
                height: 20,
                diameter: 10,
                location: { x: 10, y: 10 },
                capacity_ul: 1000,
                working_volume_ul: 800,
              },
            },
          },
          wells: null,
          location: { x: 10, y: 10, z: 0 },
          geometry: null,
          positions: {},
        },
        {
          key: "anchor_holder",
          config: {
            type: "well_plate_holder",
            name: "Anchor Holder",
            location: { x: 30, y: 30, z: 0 },
            well_plate: null,
          },
          wells: null,
          location: { x: 30, y: 30, z: 0 },
          geometry: null,
          positions: {
            bad: { x: Number.NaN, y: 30, z: 0 },
          },
        },
        {
          key: "no_center_holder",
          config: {
            type: "well_plate_holder",
            name: "No Center Holder",
            location: null,
            well_plate: null,
          },
          wells: null,
          geometry: { length: 20, width: 20, height: 5 },
          positions: {},
        },
        {
          key: "nested_null_calibration",
          config: {
            type: "well_plate_holder",
            name: "Nested Holder",
            location: { x: 90, y: 90, z: 0 },
            well_plate: {
              name: "Nested Null Plate",
              model_name: "nested_plate",
              rows: 1,
              columns: 1,
              calibration: {
                a1: null,
                a2: null,
              },
              x_offset: 9,
              y_offset: 9,
            },
          },
          wells: null,
          location: { x: 90, y: 90, z: 0 },
          geometry: { length: 20, width: 20, height: 5 },
          positions: {
            "plate.A1": { x: 90, y: 90, z: 0 },
          },
        },
        {
          key: "empty_tip_rack",
          config: {
            type: "tip_rack",
            name: "Empty Tips",
            model_name: "rack",
            rows: 1,
            columns: 1,
          },
          wells: null,
        },
        {
          key: "unsupported",
          config: {
            type: "unsupported_labware",
            name: "Unsupported",
          },
          wells: null,
        },
      ],
    } as unknown as DeckResponse;

    render(
      <DeckVisualization
        deck={edgeDeck}
        instruments={null}
        gantryPosition={null}
        machineXRange={[0, 120]}
        machineYRange={[0, 120]}
      />,
    );

    expect(screen.getByText("Nested Null Plate")).toBeInTheDocument();
    expect(screen.queryByText("Absent Vial")).not.toBeInTheDocument();
    expect(screen.queryByText("Unsupported")).not.toBeInTheDocument();
    expect(screen.getByTestId("deck-visualization").outerHTML).not.toContain("NaN");
  });

  it("returns no SVG elements for empty holder and tip rack renderers", () => {
    const { container } = render(
      <svg>
        <HolderRenderer
          label="No Geometry"
          geometry={null}
          anchor={{ x: 10, y: 10, z: 0 }}
          childPositions={[]}
          svgWidth={600}
          svgHeight={420}
          machineXRange={[0, 100]}
          machineYRange={[0, 100]}
        />
        <HolderRenderer
          label="No Center"
          geometry={{ length: 20, width: 20, height: 1 }}
          anchor={null}
          childPositions={[]}
          svgWidth={600}
          svgHeight={420}
          machineXRange={[0, 100]}
          machineYRange={[0, 100]}
        />
        <TipRackRenderer
          config={{ type: "tip_rack", name: "Empty Rack", model_name: "rack", rows: 1, columns: 1 }}
          positions={{}}
          svgWidth={600}
          svgHeight={420}
          machineXRange={[0, 100]}
          machineYRange={[0, 100]}
        />
      </svg>,
    );

    expect(container.querySelector("svg")).toBeEmptyDOMElement();
  });
});

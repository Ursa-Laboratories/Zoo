import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DeckResponse } from "../../types";
import { machineToSvg } from "../../utils/coordinates";
import DeckVisualization from "./DeckVisualization";

const SVG_W = 600;
const SVG_H = 420;
const X_RANGE: [number, number] = [0, 300];
const Y_RANGE: [number, number] = [0, 200];

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
      },
      wells: null,
      default_target: { x: 10, y: 20, z: 30 },
      render_anchor: { x: 10, y: 20, z: 30 },
      geometry: { length_mm: 9, width_mm: 9, height_mm: 6 },
      targets: {
        A1: { x: 10, y: 20, z: 30 },
        A2: { x: 19, y: 20, z: 30 },
        B1: { x: 10, y: 29, z: 30 },
        B2: { x: 19, y: 29, z: 30 },
      },
    },
    {
      key: "plate_a",
      config: {
        type: "well_plate",
        name: "Deck Plate",
        model_name: "panda_96_wellplate",
        rows: 2,
        columns: 2,
        length_mm: 127.76,
        width_mm: 85.47,
        height_mm: 14.22,
        a1: null,
        calibration: {
          a1: { x: 200, y: 20, z: 12 },
          a2: { x: 209, y: 20, z: 12 },
        },
        x_offset_mm: 9,
        y_offset_mm: 9,
        capacity_ul: 200,
        working_volume_ul: 150,
      },
      wells: {
        A1: { x: 200, y: 20, z: 12 },
        A2: { x: 209, y: 20, z: 12 },
        B1: { x: 200, y: 29, z: 12 },
        B2: { x: 209, y: 29, z: 12 },
      },
      default_target: { x: 200, y: 20, z: 12 },
      render_anchor: { x: 200, y: 20, z: 12 },
      targets: {
        A1: { x: 200, y: 20, z: 12 },
        A2: { x: 209, y: 20, z: 12 },
        B1: { x: 200, y: 29, z: 12 },
        B2: { x: 209, y: 29, z: 12 },
      },
    },
    {
      key: "vial_a",
      config: {
        type: "vial",
        name: "Deck Vial",
        model_name: "20ml_vial",
        height_mm: 57,
        diameter_mm: 28,
        location: { x: 230, y: 60, z: 31 },
        capacity_ul: 20000,
        working_volume_ul: 15000,
      },
      wells: null,
      placement_anchor: { x: 230, y: 60, z: 31 },
      render_anchor: { x: 230, y: 60, z: 31 },
      default_target: { x: 230, y: 60, z: 31 },
      targets: null,
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
          x_offset_mm: 9,
          y_offset_mm: 9,
        },
      },
      wells: null,
      placement_anchor: { x: 100, y: 120, z: 40 },
      render_anchor: { x: 100, y: 120, z: 40 },
      default_target: { x: 100, y: 120, z: 45 },
      geometry: { length_mm: 100, width_mm: 155, height_mm: 14.8 },
      targets: {
        plate: { x: 100, y: 120, z: 45 },
        "plate.A1": { x: 100, y: 120, z: 45 },
        "plate.A2": { x: 109, y: 120, z: 45 },
        "plate.B1": { x: 100, y: 129, z: 45 },
        "plate.B2": { x: 109, y: 129, z: 45 },
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
            height_mm: 57,
            diameter_mm: 28,
            location: { x: 30, y: 60 },
            capacity_ul: 20000,
            working_volume_ul: 15000,
          },
        },
      },
      wells: null,
      placement_anchor: { x: 30, y: 60, z: 8 },
      render_anchor: { x: 30, y: 60, z: 8 },
      default_target: null,
      geometry: { length_mm: 36.2, width_mm: 300.2, height_mm: 35.1 },
      targets: {
        vial_1: { x: 30, y: 60, z: 26 },
      },
    },
  ],
};

describe("DeckVisualization", () => {
  it("renders deck targets using explicit target semantics", () => {
    render(
      <DeckVisualization
        deck={deck}
        board={null}
        gantryPosition={null}
        machineXRange={X_RANGE}
        machineYRange={Y_RANGE}
      />,
    );

    expect(screen.getByText("Rack A")).toBeInTheDocument();
    expect(screen.getByText("Deck Plate")).toBeInTheDocument();
    expect(screen.getByText("Deck Vial")).toBeInTheDocument();
    expect(screen.getByText("Plate Holder")).toBeInTheDocument();
    expect(screen.getByText("Panda Plate")).toBeInTheDocument();
    expect(screen.getByText("Panda Vials")).toBeInTheDocument();
    expect(screen.getByText("Sample 1")).toBeInTheDocument();
  });

  it("places target markers at the actionable XY positions for each labware type", () => {
    render(
      <DeckVisualization
        deck={deck}
        board={null}
        gantryPosition={null}
        machineXRange={X_RANGE}
        machineYRange={Y_RANGE}
      />,
    );

    expectTargetPosition("rack_a-target-A1", 10, 20);
    expectTargetPosition("plate_a-target-A1", 200, 20);
    expectTargetPosition("vial_a-target-vial_a", 230, 60);
    expectTargetPosition("well_plate_holder-plate-target-A1", 100, 120);
    expectTargetPosition("vial_holder-target-vial_1", 30, 60);
  });
});

function expectTargetPosition(testId: string, x: number, y: number) {
  const { sx, sy } = machineToSvg(x, y, SVG_W, SVG_H, X_RANGE, Y_RANGE);
  const marker = screen.getByTestId(testId);

  expect(Number(marker.getAttribute("cx"))).toBeCloseTo(sx, 5);
  expect(Number(marker.getAttribute("cy"))).toBeCloseTo(sy, 5);
}

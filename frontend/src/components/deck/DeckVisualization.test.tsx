import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DeckVisualization from "./DeckVisualization";
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
      geometry: { length_mm: 9, width_mm: 9, height_mm: 6 },
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
          x_offset_mm: 9,
          y_offset_mm: 9,
        },
      },
      wells: null,
      location: { x: 100, y: 120, z: 40 },
      geometry: { length_mm: 100, width_mm: 155, height_mm: 14.8 },
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
            height_mm: 57,
            diameter_mm: 28,
            location: { x: 30, y: 60 },
            capacity_ul: 20000,
            working_volume_ul: 15000,
          },
        },
      },
      wells: null,
      location: { x: 30, y: 60, z: 8 },
      geometry: { length_mm: 36.2, width_mm: 300.2, height_mm: 35.1 },
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
            length_mm: 100,
            width_mm: 50,
            height_mm: 10,
            a1: null,
            calibration: {
              a1: { x: 250, y: 50, z: 10 },
              a2: { x: 330, y: 50, z: 10 },
            },
            x_offset_mm: 80,
            y_offset_mm: 9,
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
});

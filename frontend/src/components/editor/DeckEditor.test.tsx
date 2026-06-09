import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DeckEditor from "./DeckEditor";
import type { DeckResponse } from "../../types";

function deckFixture(): DeckResponse {
  return {
    filename: "deck.yaml",
    labware: [
      {
        key: "plate_1",
        config: {
          type: "well_plate",
          name: "Plate A",
          model_name: "model-a",
          rows: 8,
          columns: 12,
          length: 127.76,
          width: 85.47,
          height: 14.22,
          a1: null,
          calibration: { a1: { x: 10, y: 20, z: 30 }, a2: { x: 20, y: 20, z: 30 } },
          x_offset: 9,
          y_offset: 9,
          capacity_ul: 200,
          working_volume_ul: 150,
        },
        wells: null,
      },
      {
        key: "vial_1",
        config: {
          type: "vial",
          name: "Vial A",
          model_name: "vial-model",
          height: 66.75,
          diameter: 28,
          location: { x: 30, y: 40, z: 20 },
          capacity_ul: 1500,
          working_volume_ul: 1200,
        },
        wells: null,
      },
    ],
  };
}

function renderDeck(overrides: Partial<React.ComponentProps<typeof DeckEditor>> = {}) {
  const props = {
    configs: ["deck.yaml"],
    selectedFile: "deck.yaml" as string | null,
    onSelectFile: vi.fn(),
    onImportFile: vi.fn(),
    deck: deckFixture(),
    onSave: vi.fn(),
    onLocalChange: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
  render(<DeckEditor {...props} />);
  return props;
}

describe("DeckEditor", () => {
  it("renders well plate and vial fields and reports edits", async () => {
    const user = userEvent.setup();
    const props = renderDeck();

    expect(screen.getByDisplayValue("Plate A")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Vial A")).toBeInTheDocument();
    // well-plate-only field (required label renders "Rows *")
    expect(screen.getByLabelText(/^Rows/)).toHaveValue("8");
    // vial-only field
    expect(screen.getByLabelText("Diameter (mm)")).toHaveValue("28");

    await user.type(screen.getByDisplayValue("Plate A"), "!");
    expect(props.onLocalChange).toHaveBeenCalled();
  });

  it("shows the unsaved banner only when dirty", () => {
    const { unmount } = render(
      <DeckEditor {...baseProps()} dirty={false} />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();

    render(<DeckEditor {...baseProps()} dirty />);
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent(/Unsaved changes/i);
    expect(banner).toHaveTextContent(/save this deck/i);
  });

  it("adds and removes labware", async () => {
    const user = userEvent.setup();
    const props = renderDeck({ deck: { filename: "deck.yaml", labware: [] } });

    await user.click(screen.getByRole("button", { name: "+ Well Plate" }));
    await user.click(screen.getByRole("button", { name: "+ Vial" }));
    expect(props.onLocalChange).toHaveBeenCalled();
    expect(screen.getByText("wellplate_1")).toBeInTheDocument();
    expect(screen.getByText("vial_2")).toBeInTheDocument();

    // First Remove button belongs to the first card (wellplate_1).
    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    expect(screen.queryByText("wellplate_1")).not.toBeInTheDocument();
    expect(screen.getByText("vial_2")).toBeInTheDocument();
  });

  it("saves the deck and disables Save when a required name is blank", async () => {
    const user = userEvent.setup();
    const props = renderDeck();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onSave).toHaveBeenCalledWith(
      "deck.yaml",
      expect.objectContaining({ labware: expect.objectContaining({ plate_1: expect.anything() }) }),
    );

    await user.clear(screen.getByDisplayValue("Plate A"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("edits well-plate and vial detail fields", async () => {
    const user = userEvent.setup();
    const props = renderDeck();

    // well-plate-only numeric fields + calibration coordinate
    await user.clear(screen.getByLabelText(/^Columns/));
    await user.type(screen.getByLabelText(/^Columns/), "6");
    await user.clear(screen.getByLabelText("Length (mm)"));
    await user.type(screen.getByLabelText("Length (mm)"), "120");
    await user.clear(screen.getByLabelText(/^Well pitch X/));
    await user.type(screen.getByLabelText(/^Well pitch X/), "10");
    await user.clear(screen.getByLabelText("Calibration A1 X"));
    await user.type(screen.getByLabelText("Calibration A1 X"), "5");

    // vial-only fields
    await user.clear(screen.getByLabelText("Diameter (mm)"));
    await user.type(screen.getByLabelText("Diameter (mm)"), "30");
    await user.clear(screen.getByLabelText("Location Z"));
    await user.type(screen.getByLabelText("Location Z"), "25");

    // shared label (well plate + vial both have "Capacity (uL)")
    await user.clear(screen.getAllByLabelText("Capacity (uL)")[1]);
    await user.type(screen.getAllByLabelText("Capacity (uL)")[1], "1600");

    expect(props.onLocalChange).toHaveBeenCalled();
  });

  it("passes unsupported labware through with an explanatory note", () => {
    render(
      <DeckEditor
        {...baseProps()}
        deck={{
          filename: "deck.yaml",
          labware: [
            { key: "trash_1", config: { type: "tip_disposal", name: "Trash" }, wells: null },
          ],
        }}
      />,
    );
    expect(screen.getByText(/editing not supported/i)).toBeInTheDocument();
    expect(screen.getByText("tip_disposal")).toBeInTheDocument();
  });
});

function baseProps() {
  return {
    configs: ["deck.yaml"],
    selectedFile: "deck.yaml" as string | null,
    onSelectFile: vi.fn(),
    onImportFile: vi.fn(),
    deck: deckFixture(),
    onSave: vi.fn(),
    onLocalChange: vi.fn(),
    onRefresh: vi.fn(),
  };
}

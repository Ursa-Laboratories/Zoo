import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ProtocolEditor from "./ProtocolEditor";
import type { CommandInfo, DeckResponse, GantryResponse, ProtocolStep } from "../../types";

const COMMANDS: CommandInfo[] = [
  {
    name: "move",
    description: "Move",
    args: [
      { name: "instrument", type: "str", required: true, default: null },
      { name: "position", type: "Any", required: true, default: null },
      { name: "travel_z", type: "float | None", required: false, default: null },
    ],
  },
  {
    name: "scan",
    description: "Scan",
    args: [
      { name: "plate", type: "str", required: true, default: null },
      { name: "instrument", type: "str", required: true, default: null },
      { name: "method", type: "str", required: true, default: null },
      { name: "measurement_height", type: "float", required: true, default: null },
      { name: "method_kwargs", type: "Dict[str, Any] | None", required: false, default: null },
    ],
  },
];

const DECK: DeckResponse = {
  filename: "deck.yaml",
  labware: [
    {
      key: "plate_1",
      config: {
        type: "well_plate",
        name: "Plate",
        model_name: "m",
        rows: 2,
        columns: 2,
        length: 100,
        width: 80,
        height: 14,
        a1: null,
        calibration: { a1: { x: 0, y: 0, z: 0 }, a2: { x: 9, y: 0, z: 0 } },
        x_offset: 9,
        y_offset: 9,
        capacity_ul: 200,
        working_volume_ul: 150,
      },
      wells: null,
    },
  ],
};

const GANTRY: GantryResponse = {
  filename: "g.yaml",
  config: {
    serial_port: "",
    gantry_type: "cub_xl",
    cnc: { homing_strategy: "standard", factory_z_travel_mm: 80, y_axis_motion: "head", safe_z: 80 },
    working_volume: { x_min: 0, x_max: 300, y_min: 0, y_max: 200, z_min: 0, z_max: 80 },
    grbl_settings: {},
    instruments: {
      asmi: { type: "asmi", vendor: "vernier", offset_x: 0, offset_y: 0 },
      pip: { type: "pipette", vendor: "opentrons", offset_x: 0, offset_y: 0 },
    },
  },
};

const STEPS: ProtocolStep[] = [
  { command: "move", args: { instrument: "asmi", position: "plate_1.A1", travel_z: 3 } },
];

function renderProtocol(overrides: Partial<React.ComponentProps<typeof ProtocolEditor>> = {}) {
  const props: React.ComponentProps<typeof ProtocolEditor> = {
    configs: ["move.yaml"],
    selectedFile: "move.yaml",
    onSelectFile: vi.fn(),
    commands: COMMANDS,
    deck: DECK,
    gantry: GANTRY,
    steps: STEPS,
    positions: null,
    onSave: vi.fn(),
    onLocalChange: vi.fn(),
    onPositionsChange: vi.fn(),
    onValidate: vi.fn(),
    validationErrors: null,
    isValidating: false,
    onRefresh: vi.fn(),
    onRun: vi.fn(),
    unsavedConfigs: [],
    canRun: true,
    isRunning: false,
    runResult: null,
    runError: null,
    ...overrides,
  };
  render(<ProtocolEditor {...props} />);
  return props;
}

describe("ProtocolEditor", () => {
  it("shows the empty state when no steps are loaded", () => {
    renderProtocol({ steps: null });
    expect(screen.getByText("Load a protocol or add steps.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run Protocol" })).not.toBeInTheDocument();
  });

  it("prompts to save the protocol itself and marks the Save button when protocol is dirty", () => {
    renderProtocol({ unsavedConfigs: ["Protocol"] });
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent(/Save this protocol before running/i);
    // Save button keeps the accessible name "Save" with an aria-hidden "*".
    expect(screen.getByRole("button", { name: "Save" })).toHaveTextContent("*");
    expect(screen.getByRole("button", { name: "Run Protocol" })).toBeDisabled();
  });

  it("points to another tab when only the deck is dirty", () => {
    renderProtocol({ unsavedConfigs: ["Deck"] });
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent(/Deck has unsaved edits/i);
    expect(banner).toHaveTextContent(/save it in the Deck tab/i);
    // The protocol's own Save button is not marked dirty.
    expect(screen.getByRole("button", { name: "Save" })).not.toHaveTextContent("*");
  });

  it("pluralizes the pointer when multiple other tabs are dirty", () => {
    renderProtocol({ unsavedConfigs: ["Gantry", "Deck"] });
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent(/have unsaved edits/i);
    expect(banner).toHaveTextContent(/save them in their tabs/i);
  });

  it("runs when nothing is dirty and the gantry can run", async () => {
    const user = userEvent.setup();
    const props = renderProtocol();
    const runButton = screen.getByRole("button", { name: "Run Protocol" });
    expect(runButton).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(runButton);
    expect(props.onRun).toHaveBeenCalled();
  });

  it("disables Run while the gantry cannot run", () => {
    renderProtocol({ canRun: false });
    expect(screen.getByRole("button", { name: "Run Protocol" })).toBeDisabled();
  });

  it("validates the current config", async () => {
    const user = userEvent.setup();
    const props = renderProtocol();
    await user.click(screen.getByRole("button", { name: "Validate" }));
    expect(props.onValidate).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: expect.any(Array) }),
    );
  });

  it("adds, reorders, and removes steps", async () => {
    const user = userEvent.setup();
    const props = renderProtocol();

    await user.selectOptions(screen.getByRole("combobox", { name: "Add step" }), "scan");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(props.onLocalChange).toHaveBeenCalled();

    // Two steps now → the first step's down-arrow becomes actionable.
    // Buttons are labelled by their glyph (↓ / ✕), not the title.
    await user.click(screen.getAllByRole("button", { name: "↓" })[0]);
    await user.click(screen.getAllByRole("button", { name: "✕" })[0]);
    expect(props.onLocalChange).toHaveBeenCalledTimes(3);
  });

  it("adds and removes named positions", async () => {
    const user = userEvent.setup();
    const props = renderProtocol();

    await user.click(screen.getByRole("button", { name: "Add Position" }));
    expect(props.onPositionsChange).toHaveBeenCalled();

    const nameField = await screen.findByLabelText("Position 1 name");
    await user.clear(nameField);
    await user.type(nameField, "park");
    await user.click(screen.getByRole("button", { name: /Remove park/i }));
    // Last call clears positions back to null.
    expect(props.onPositionsChange).toHaveBeenLastCalledWith(null);
  });

  it("exposes ASMI indentation method options for an asmi scan step", async () => {
    const user = userEvent.setup();
    const props = renderProtocol({ steps: [] });

    await user.selectOptions(screen.getByRole("combobox", { name: "Add step" }), "scan");
    await user.click(screen.getByRole("button", { name: "Add" }));

    // asmi is the first instrument and "indentation" its default method, so
    // the ASMI method-options grid renders.
    expect(await screen.findByLabelText("Force limit (N)")).toHaveValue("10");
    await user.clear(screen.getByLabelText("Force limit (N)"));
    await user.type(screen.getByLabelText("Force limit (N)"), "12");
    expect(props.onLocalChange).toHaveBeenCalled();
  });

  it("renames a named position and rewrites the steps that reference it", async () => {
    const user = userEvent.setup();
    const props = renderProtocol({
      steps: [{ command: "move", args: { instrument: "asmi", position: "park", travel_z: 1 } }],
      positions: { park: [1, 2, 3] },
    });

    // Append (don't clear) so "park" -> "park2" is a single rename that
    // can be propagated into the referencing step.
    await user.type(screen.getByLabelText("Position 1 name"), "2");
    expect(props.onPositionsChange).toHaveBeenCalled();
    expect(props.onLocalChange).toHaveBeenCalled();
  });

  it("renders run results and errors", () => {
    const { unmount } = render(
      <ProtocolEditor {...baseProps()} runResult={{ status: "complete", steps_executed: 2 }} />,
    );
    expect(screen.getByText(/2 steps executed/i)).toBeInTheDocument();
    unmount();

    render(<ProtocolEditor {...baseProps()} runError="boom" />);
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});

function baseProps(): React.ComponentProps<typeof ProtocolEditor> {
  return {
    configs: ["move.yaml"],
    selectedFile: "move.yaml",
    onSelectFile: vi.fn(),
    commands: COMMANDS,
    deck: DECK,
    gantry: GANTRY,
    steps: STEPS,
    positions: null,
    onSave: vi.fn(),
    onLocalChange: vi.fn(),
    onPositionsChange: vi.fn(),
    onValidate: vi.fn(),
    validationErrors: null,
    isValidating: false,
    onRefresh: vi.fn(),
    onRun: vi.fn(),
    unsavedConfigs: [],
    canRun: true,
    isRunning: false,
    runResult: null,
    runError: null,
  };
}

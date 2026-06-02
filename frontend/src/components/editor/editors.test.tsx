import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DeckEditor from "./DeckEditor";
import GantryEditor from "./GantryEditor";
import ProtocolEditor from "./ProtocolEditor";
import type {
  CommandInfo,
  DeckResponse,
  GantryConfig,
  GantryResponse,
  InstrumentSchemas,
  InstrumentTypeInfo,
} from "../../types";

function deckFixture(): DeckResponse {
  return {
    filename: "deck.yaml",
    labware: [
      {
        key: "plate_1",
        config: {
          type: "well_plate",
          name: "Plate 1",
          model_name: "plate-model",
          rows: 2,
          columns: 2,
          length: 127.76,
          width: 85.47,
          height: 14.22,
          a1: null,
          calibration: {
            a1: { x: 10, y: 20, z: 30 },
            a2: { x: 19, y: 20, z: 30 },
          },
          x_offset: 9,
          y_offset: 9,
          capacity_ul: 200,
          working_volume_ul: 150,
        },
        wells: {
          A1: { x: 10, y: 20, z: 30 },
          A2: { x: 19, y: 20, z: 30 },
        },
      },
      {
        key: "vial_1",
        config: {
          type: "vial",
          name: "Sample Vial",
          model_name: "vial-model",
          height: 66.75,
          diameter: 28,
          location: { x: 30, y: 40, z: 20 },
          capacity_ul: 1500,
          working_volume_ul: 1200,
        },
        wells: null,
      },
      {
        key: "rack_1",
        config: {
          type: "tip_rack",
          name: "Tip Rack",
          model_name: "rack-model",
          rows: 1,
          columns: 1,
        },
        wells: null,
      },
    ],
  };
}

function gantryConfig(): GantryConfig {
  return {
    serial_port: "/dev/ttyUSB0",
    gantry_type: "cub_xl",
    cnc: {
      homing_strategy: "standard",
      factory_z_travel_mm: 90,
      calibration_block_height_mm: 35,
      y_axis_motion: "head",
      safe_z: 80,
    },
    working_volume: { x_min: 0, x_max: 300, y_min: 0, y_max: 200, z_min: 0, z_max: 80 },
    grbl_settings: {
      soft_limits: true,
      homing_pull_off: 10,
      max_travel_x: 310,
    },
    instruments: {
      asmi_1: {
        type: "asmi",
        vendor: "vernier",
        offset_x: 1,
        offset_y: 2,
        depth: 3,
        measurement_height: 4,
        safe_approach_height: 5,
        mode: "force",
        enabled: true,
        gain: 2.5,
        note: "ready",
      },
    },
  };
}

function gantryFixture(): GantryResponse {
  return { filename: "gantry.yaml", config: gantryConfig() };
}

const instrumentTypes: InstrumentTypeInfo[] = [
  { type: "asmi", vendors: ["vernier"], is_mock: false },
  { type: "pipette", vendors: ["opentrons"], is_mock: false },
  { type: "custom_tool", vendors: [], is_mock: true },
];

const instrumentSchemas: InstrumentSchemas = {
  asmi: [
    { name: "mode", type: "str", required: true, default: "force", choices: ["force", "distance"] },
    { name: "enabled", type: "bool", required: false, default: true, choices: null },
    { name: "gain", type: "float", required: false, default: 1.5, choices: null },
    { name: "note", type: "str", required: false, default: "ready", choices: null },
  ],
  pipette: [
    { name: "port", type: "str", required: true, default: "/dev/ttyUSB0", choices: null },
  ],
};

const commands: CommandInfo[] = [
  {
    name: "move",
    description: "Move to a position",
    args: [
      { name: "instrument", type: "str", required: true, default: null },
      { name: "position", type: "str", required: true, default: null },
      { name: "travel_z", type: "float | None", required: false, default: null },
    ],
  },
  {
    name: "scan",
    description: "Scan a plate",
    args: [
      { name: "plate", type: "str", required: true, default: null },
      { name: "instrument", type: "str", required: true, default: null },
      { name: "method", type: "str", required: true, default: null },
      { name: "measurement_height", type: "float", required: true, default: null },
      { name: "method_kwargs", type: "Dict[str, Any] | None", required: false, default: null },
    ],
  },
  {
    name: "wait",
    description: "Wait",
    args: [
      { name: "seconds", type: "float", required: true, default: null },
      { name: "comment", type: "str", required: false, default: "pause" },
    ],
  },
];

describe("DeckEditor", () => {
  it("edits, preserves, removes, and saves deck labware", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onLocalChange = vi.fn();
    const onSelectFile = vi.fn();
    render(
      <DeckEditor
        configs={["deck.yaml"]}
        selectedFile="deck.yaml"
        onSelectFile={onSelectFile}
        onImportFile={vi.fn()}
        deck={deckFixture()}
        onSave={onSave}
        onLocalChange={onLocalChange}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText(/editing not supported/i)).toHaveTextContent("tip_rack");
    await user.clear(screen.getByLabelText(/^Rows/));
    await user.type(screen.getByLabelText(/^Rows/), "3");
    await user.clear(screen.getByLabelText("Calibration A1 X"));
    await user.type(screen.getByLabelText("Calibration A1 X"), "12");
    await user.clear(screen.getByLabelText("Diameter (mm)"));
    await user.type(screen.getByLabelText("Diameter (mm)"), "31");
    await user.click(within(screen.getByText("rack_1").closest("div")!).getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "+ Well Plate" }));
    await user.click(screen.getByRole("button", { name: "+ Vial" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      "deck.yaml",
      expect.objectContaining({
        labware: expect.objectContaining({
          plate_1: expect.objectContaining({ rows: 3 }),
          vial_1: expect.objectContaining({ diameter: 31 }),
          wellplate_3: expect.objectContaining({ type: "well_plate", name: "wellplate_3" }),
          vial_4: expect.objectContaining({ type: "vial", name: "vial_4" }),
        }),
      }),
    ));
    expect(onSave.mock.calls[0][1].labware.rack_1).toBeUndefined();
    expect(onSelectFile).toHaveBeenCalledWith("deck.yaml");
    expect(onLocalChange).toHaveBeenCalled();
  });

  it("requires editable labware names before saving", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <DeckEditor
        configs={[]}
        selectedFile="deck.yaml"
        onSelectFile={vi.fn()}
        onImportFile={vi.fn()}
        deck={deckFixture()}
        onSave={onSave}
        onLocalChange={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    await user.clear(screen.getByDisplayValue("Plate 1"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("GantryEditor", () => {
  it("starts a new gantry config and saves a normalized filename", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onSelectFile = vi.fn();
    const onLocalChange = vi.fn();
    render(
      <GantryEditor
        configs={[]}
        selectedFile={null}
        onSelectFile={onSelectFile}
        gantry={null}
        baseline={null}
        instrumentTypes={instrumentTypes}
        instrumentSchemas={instrumentSchemas}
        onSave={onSave}
        onLocalChange={onLocalChange}
        onRefresh={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "+ New config" }));
    await user.type(screen.getByPlaceholderText("my_gantry.yaml"), "new_gantry");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      "new_gantry.yaml",
      expect.objectContaining({ gantry_type: "cub_xl", instruments: {} }),
    ));
    expect(onSelectFile).toHaveBeenCalledWith("new_gantry.yaml");
    expect(onLocalChange).toHaveBeenCalledWith(expect.objectContaining({ filename: "unsaved" }));
  });

  it("edits CNC, GRBL, and schema-driven instrument fields", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onLocalChange = vi.fn();
    render(
      <GantryEditor
        configs={["gantry.yaml"]}
        selectedFile="gantry.yaml"
        onSelectFile={vi.fn()}
        gantry={gantryFixture()}
        baseline={gantryFixture()}
        instrumentTypes={instrumentTypes}
        instrumentSchemas={instrumentSchemas}
        onSave={onSave}
        onLocalChange={onLocalChange}
        onRefresh={vi.fn()}
      />,
    );

    const serialPort = screen.getByDisplayValue("/dev/ttyUSB0");
    const factoryZTravel = screen.getByDisplayValue("90");
    await user.clear(serialPort);
    await user.type(serialPort, "/dev/ttyUSB9");
    await user.selectOptions(screen.getByLabelText(/^Gantry type/), "cub");
    await user.selectOptions(screen.getByLabelText("Y-axis motion"), "bed");
    await user.clear(factoryZTravel);
    await user.type(factoryZTravel, "95");
    await user.selectOptions(screen.getByLabelText("Soft limits"), "false");
    const homingPullOff = screen.getByDisplayValue("10");
    await user.clear(homingPullOff);
    await user.type(homingPullOff, "12");
    await user.click(within(screen.getByLabelText("Max travel X").closest("div")!.parentElement!).getByRole("button", { name: "Clear" }));
    await user.selectOptions(screen.getByLabelText("Mode *"), "distance");
    await user.selectOptions(screen.getByLabelText("Enabled"), "false");
    await user.clear(screen.getByLabelText("Gain"));
    await user.type(screen.getByLabelText("Gain"), "3.25");
    const note = screen.getByDisplayValue("ready");
    await user.clear(note);
    await user.type(note, "updated");
    const addTypeSelect = screen.getAllByRole("combobox").find((select) => (
      within(select).queryByRole("option", { name: "Pipette" })
    ));
    expect(addTypeSelect).toBeDefined();
    await user.selectOptions(addTypeSelect!, "pipette");
    await user.click(screen.getByRole("button", { name: "+ Add" }));
    await user.click(within(screen.getByText("pipette_2").closest("div")!).getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0][1] as GantryConfig;
    expect(saved.serial_port).toBe("/dev/ttyUSB9");
    expect(saved.gantry_type).toBe("cub");
    expect(saved.cnc.factory_z_travel_mm).toBe(95);
    expect(saved.cnc.y_axis_motion).toBe("bed");
    expect(saved.grbl_settings?.soft_limits).toBe(false);
    expect(saved.grbl_settings?.homing_pull_off).toBe(12);
    expect(saved.grbl_settings?.max_travel_x).toBeUndefined();
    expect(saved.instruments.asmi_1).toMatchObject({
      mode: "distance",
      enabled: false,
      gain: 3.25,
      note: "updated",
    });
    expect(saved.instruments.pipette_2).toBeUndefined();
    expect(onLocalChange).toHaveBeenCalled();
    expect(screen.getAllByTitle("Unsaved local edit").length).toBeGreaterThan(0);
  });

  it("disables save for unsafe gantry values", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <GantryEditor
        configs={[]}
        selectedFile="gantry.yaml"
        onSelectFile={vi.fn()}
        gantry={gantryFixture()}
        baseline={null}
        instrumentTypes={instrumentTypes}
        instrumentSchemas={instrumentSchemas}
        onSave={onSave}
        onRefresh={vi.fn()}
      />,
    );

    await user.clear(screen.getByLabelText("Z max"));
    await user.type(screen.getByLabelText("Z max"), "120");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("ProtocolEditor", () => {
  it("edits named positions, renames references, validates, saves, and runs", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onLocalChange = vi.fn();
    const onPositionsChange = vi.fn();
    const onValidate = vi.fn();
    const onRun = vi.fn();
    render(
      <ProtocolEditor
        configs={["protocol.yaml"]}
        selectedFile="protocol.yaml"
        onSelectFile={vi.fn()}
        commands={commands}
        deck={deckFixture()}
        gantry={gantryFixture()}
        steps={[{ command: "move", args: { instrument: "asmi_1", position: "park", travel_z: 3 } }]}
        positions={{ park: [10, 20, 30] }}
        onSave={onSave}
        onLocalChange={onLocalChange}
        onPositionsChange={onPositionsChange}
        onValidate={onValidate}
        validationErrors={[]}
        isValidating={false}
        onRun={onRun}
        canRun
        isRunning={false}
        runResult={{ status: "ok", steps_executed: 1 }}
        runError={null}
        onRefresh={vi.fn()}
      />,
    );

    await user.clear(screen.getByLabelText("Position 1 name"));
    await user.type(screen.getByLabelText("Position 1 name"), "staging");
    await user.selectOptions(screen.getByLabelText(/^Position \*$/), "staging");
    await user.clear(screen.getByLabelText("staging coordinates Z"));
    await user.type(screen.getByLabelText("staging coordinates Z"), "44");
    await user.click(screen.getByRole("button", { name: "Add Position" }));
    await user.clear(screen.getByLabelText("Position 2 name"));
    await user.type(screen.getByLabelText("Position 2 name"), "staging");
    expect(screen.getByText('Position "staging" is duplicated.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Position 2 name"));
    await user.type(screen.getByLabelText("Position 2 name"), "parking_2");
    await user.click(screen.getByRole("button", { name: "Validate" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Run Protocol" }));

    expect(onValidate).toHaveBeenCalledWith(expect.objectContaining({
      positions: expect.objectContaining({ staging: [10, 20, 44] }),
    }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      "protocol.yaml",
      expect.objectContaining({
        positions: expect.objectContaining({ parking_2: [0, 0, 0] }),
        protocol: [expect.objectContaining({ args: expect.objectContaining({ position: "staging" }) })],
      }),
    ));
    expect(onRun).toHaveBeenCalledOnce();
    expect(onLocalChange).toHaveBeenCalled();
    expect(onPositionsChange).toHaveBeenCalled();
    expect(screen.getByText(/Protocol complete/)).toHaveTextContent("1 steps executed");
  });

  it("adds defaulted steps and handles unknown commands and validation output", async () => {
    const user = userEvent.setup();
    render(
      <ProtocolEditor
        configs={[]}
        selectedFile="protocol.yaml"
        onSelectFile={vi.fn()}
        commands={commands}
        deck={deckFixture()}
        gantry={gantryFixture()}
        steps={[{ command: "missing_command", args: {} }]}
        positions={null}
        onSave={vi.fn()}
        onValidate={vi.fn()}
        validationErrors={["Step 0: bad command", "Global setup error"]}
        isValidating={true}
        onRun={vi.fn()}
        canRun={false}
        isRunning={true}
        runResult={null}
        runError="Gantry disconnected"
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText("Unknown command: missing_command")).toBeInTheDocument();
    expect(screen.getAllByText("Step 0: bad command").length).toBeGreaterThan(0);
    expect(screen.getByText("Global setup error")).toBeInTheDocument();
    expect(screen.getByText("Gantry disconnected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Running..." })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Add step"), "scan");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByLabelText(/Plate/)).toHaveValue("plate_1");
    expect(screen.getByLabelText(/Instrument/)).toHaveValue("asmi_1");
    expect(screen.getByLabelText(/^Measurement \*$/)).toHaveValue("indentation");
    expect(screen.getByLabelText("Force limit (N)")).toHaveValue("10");
  });
});

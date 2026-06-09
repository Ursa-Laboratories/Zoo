import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import GantryEditor from "./GantryEditor";
import type { GantryResponse, InstrumentSchemas, InstrumentTypeInfo } from "../../types";

const INSTRUMENT_TYPES: InstrumentTypeInfo[] = [
  { type: "pipette", vendors: ["opentrons"], is_mock: false },
  { type: "asmi", vendors: ["vernier"], is_mock: false },
];

const INSTRUMENT_SCHEMAS: InstrumentSchemas = {
  pipette: [{ name: "port", type: "str", required: true, default: "/dev/ttyUSB0", choices: null }],
  asmi: [
    { name: "mode", type: "str", required: false, default: "a", choices: ["a", "b"] },
    { name: "enabled", type: "bool", required: false, default: false, choices: null },
    { name: "gain", type: "float", required: true, default: 1, choices: null },
    { name: "label", type: "str", required: false, default: "x", choices: null },
  ],
};

function gantryFixture(overrides: Partial<GantryResponse["config"]> = {}): GantryResponse {
  return {
    filename: "cubos.yaml",
    config: {
      serial_port: "/dev/ttyUSB0",
      gantry_type: "cub_xl",
      cnc: {
        homing_strategy: "standard",
        factory_z_travel_mm: 80,
        calibration_block_height_mm: 35,
        y_axis_motion: "head",
        safe_z: 80,
      },
      working_volume: { x_min: 0, x_max: 300, y_min: 0, y_max: 200, z_min: 0, z_max: 80 },
      grbl_settings: { soft_limits: true, steps_per_mm_x: 400 },
      instruments: {
        pipette_1: {
          type: "pipette",
          vendor: "opentrons",
          offset_x: 1,
          offset_y: 2,
          depth: 0,
          measurement_height: 0,
          safe_approach_height: 0,
          port: "/dev/ttyUSB0",
        },
        asmi_1: {
          type: "asmi",
          vendor: "vernier",
          offset_x: 0,
          offset_y: 0,
          depth: 0,
          measurement_height: 0,
          safe_approach_height: 0,
          mode: "a",
          enabled: false,
          gain: 1,
          label: "x",
        },
      },
      ...overrides,
    },
  };
}

function renderGantry(overrides: Partial<React.ComponentProps<typeof GantryEditor>> = {}) {
  const gantry = overrides.gantry ?? gantryFixture();
  const props = {
    configs: ["cubos.yaml"],
    selectedFile: "cubos.yaml" as string | null,
    onSelectFile: vi.fn(),
    gantry,
    baseline: gantry,
    instrumentTypes: INSTRUMENT_TYPES,
    instrumentSchemas: INSTRUMENT_SCHEMAS,
    onSave: vi.fn(),
    onLocalChange: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
  render(<GantryEditor {...props} />);
  return props;
}

describe("GantryEditor", () => {
  it("renders connection, instruments, and all instrument-schema field types", () => {
    renderGantry();
    expect(screen.getByLabelText("Serial port")).toHaveValue("/dev/ttyUSB0");
    expect(screen.getByLabelText("Port *")).toHaveValue("/dev/ttyUSB0");
    // asmi schema fields: choices, bool, float, str
    expect(screen.getByLabelText("Mode")).toBeInTheDocument();
    expect(screen.getByLabelText("Enabled")).toBeInTheDocument();
    expect(screen.getByLabelText("Gain *")).toHaveValue("1");
    expect(screen.getByLabelText("Label")).toHaveValue("x");
  });

  it("keeps GRBL under the Advanced settings expander", async () => {
    const user = userEvent.setup();
    renderGantry();

    expect(screen.queryByLabelText("Steps/mm X")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Advanced settings/ }));
    expect(screen.getByLabelText("Steps/mm X")).toHaveValue("400");
    expect(screen.getByLabelText("Soft limits")).toBeInTheDocument();
  });

  it("auto-expands Advanced settings and marks it dirty when GRBL differs from the saved baseline", () => {
    const gantry = gantryFixture({ grbl_settings: { steps_per_mm_x: 400 } });
    const baseline = gantryFixture({ grbl_settings: { steps_per_mm_x: 200 } });
    renderGantry({ gantry, baseline });

    // Expanded on mount — no click needed — because GRBL has unsaved edits.
    expect(screen.getByRole("button", { name: /Advanced settings/ })).toHaveAttribute("aria-expanded", "true");
    // Label gains an amber "*" when dirty, so match loosely.
    expect(screen.getByLabelText(/Steps\/mm X/)).toHaveValue("400");
    expect(screen.getByRole("button", { name: /Advanced settings/ })).toHaveTextContent("*");
  });

  it("clears an optional GRBL number field", async () => {
    const user = userEvent.setup();
    const props = renderGantry();
    await user.click(screen.getByRole("button", { name: /Advanced settings/ }));

    // Most GRBL number fields are unset (Clear disabled); click the one
    // that actually has a value (steps_per_mm_x).
    const enabledClear = screen
      .getAllByRole("button", { name: "Clear" })
      .find((b) => !(b as HTMLButtonElement).disabled)!;
    await user.click(enabledClear);
    expect(props.onLocalChange).toHaveBeenCalled();
  });

  it("starts a brand-new config and reports the edit", async () => {
    const user = userEvent.setup();
    const props = renderGantry({ gantry: null, baseline: null, selectedFile: null });

    expect(screen.queryByLabelText("Serial port")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "+ New config" }));
    expect(props.onLocalChange).toHaveBeenCalled();
    expect(await screen.findByLabelText("Serial port")).toBeInTheDocument();
  });

  it("adds and removes an instrument", async () => {
    const user = userEvent.setup();
    const props = renderGantry();

    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "+ Add" }));
    expect(props.onLocalChange).toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(3);

    await user.click(screen.getAllByRole("button", { name: "Remove" })[2]);
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
  });

  it("shows the unsaved banner only when dirty", () => {
    const { unmount } = render(<GantryEditor {...renderProps()} dirty={false} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();

    render(<GantryEditor {...renderProps()} dirty />);
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent(/Unsaved changes/i);
    expect(banner).toHaveTextContent(/save this gantry/i);
  });

  it("edits connection selects, working volume, GRBL booleans, and instrument schema fields", async () => {
    const user = userEvent.setup();
    const props = renderGantry();

    await user.selectOptions(screen.getByLabelText(/Gantry type/), "cub");
    await user.selectOptions(screen.getByLabelText("Y-axis motion"), "bed");
    await user.clear(screen.getByLabelText("X max"));
    await user.type(screen.getByLabelText("X max"), "250");

    // asmi instrument schema fields: choices, bool, float, str
    await user.selectOptions(screen.getByLabelText("Mode"), "b");
    await user.selectOptions(screen.getByLabelText("Enabled"), "true");
    await user.clear(screen.getByLabelText("Gain *"));
    await user.type(screen.getByLabelText("Gain *"), "2");

    // GRBL boolean inside the Advanced panel
    await user.click(screen.getByRole("button", { name: /Advanced settings/ }));
    await user.selectOptions(screen.getByLabelText("Soft limits"), "false");

    expect(props.onLocalChange).toHaveBeenCalled();
  });

  it("disables Save when the working volume is invalid", async () => {
    const user = userEvent.setup();
    renderGantry();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();

    const xMin = screen.getByLabelText("X min");
    await user.clear(xMin);
    await user.type(xMin, "400"); // x_min >= x_max (300)
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves a valid config", async () => {
    const user = userEvent.setup();
    const props = renderGantry();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onSave).toHaveBeenCalledWith("cubos.yaml", expect.objectContaining({ serial_port: "/dev/ttyUSB0" }));
    expect(props.onSelectFile).toHaveBeenCalledWith("cubos.yaml");
  });
});

function renderProps() {
  const gantry = gantryFixture();
  return {
    configs: ["cubos.yaml"],
    selectedFile: "cubos.yaml" as string | null,
    onSelectFile: vi.fn(),
    gantry,
    baseline: gantry,
    instrumentTypes: INSTRUMENT_TYPES,
    instrumentSchemas: INSTRUMENT_SCHEMAS,
    onSave: vi.fn(),
    onLocalChange: vi.fn(),
    onRefresh: vi.fn(),
  };
}

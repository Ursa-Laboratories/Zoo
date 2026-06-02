import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CoordinateField, DirtyMarker, NumberField, SaveButton, SelectField, TextField } from "./fields";

describe("editor fields", () => {
  it("parses numeric input without committing partial numbers", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <NumberField label="Travel" value={1} onChange={onChange} required dirty />,
    );

    expect(screen.getByTitle("Unsaved local edit")).toBeInTheDocument();
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "-");
    expect(onChange).not.toHaveBeenCalled();
    await user.type(input, "2.5");
    expect(onChange).toHaveBeenLastCalledWith(-2.5);

    rerender(<NumberField label="Travel" value={3} onChange={onChange} />);
    expect(screen.getByLabelText("Travel")).toHaveValue("3");
    fireEvent.blur(screen.getByLabelText("Travel"));
    expect(screen.getByLabelText("Travel")).toHaveValue("3");
  });

  it("renders non-finite numeric values as empty inputs", () => {
    render(<NumberField label="Travel" value={Number.NaN} onChange={vi.fn()} />);

    expect(screen.getByLabelText("Travel")).toHaveValue("");
  });

  it("marks empty required text fields and reports edits", () => {
    const onChange = vi.fn();
    render(<TextField label="Serial port" value="" onChange={onChange} required dirty />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "/dev/ttyUSB0" } });

    expect(onChange).toHaveBeenLastCalledWith("/dev/ttyUSB0");
    expect(screen.getByTitle("Unsaved local edit")).toHaveTextContent("*");
  });

  it("edits coordinates and resets raw axis text on blur", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CoordinateField
        label="Location"
        value={{ x: 1, y: 2, z: 3 }}
        onChange={onChange}
        required
      />,
    );

    await user.clear(screen.getByLabelText("Location X"));
    await user.type(screen.getByLabelText("Location X"), "4");
    await user.clear(screen.getByLabelText("Location Y"));
    await user.type(screen.getByLabelText("Location Y"), "5");
    await user.clear(screen.getByLabelText("Location Z"));
    await user.type(screen.getByLabelText("Location Z"), "6");

    expect(onChange).toHaveBeenCalledWith({ x: 4, y: 2, z: 3 });
    expect(onChange).toHaveBeenCalledWith({ x: 1, y: 5, z: 3 });
    expect(onChange).toHaveBeenCalledWith({ x: 1, y: 2, z: 6 });
    fireEvent.blur(screen.getByLabelText("Location X"));
    expect(screen.getByLabelText("Location X")).toHaveValue("1");
  });

  it("renders select fallback choices and save button state", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onSave = vi.fn();
    const { rerender } = render(
      <>
        <SelectField label="Config" value="" options={[]} onChange={onSelect} />
        <SaveButton disabled onClick={onSave} />
        <DirtyMarker />
      </>,
    );

    expect(screen.getByRole("option", { name: "No configs found" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();

    rerender(
      <>
        <SelectField label="Config" value="a.yaml" options={["a.yaml", "b.yaml"]} onChange={onSelect} />
        <SaveButton onClick={onSave} />
      </>,
    );
    await user.selectOptions(screen.getByLabelText("Config"), "b.yaml");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSelect).toHaveBeenCalledWith("b.yaml");
    expect(onSave).toHaveBeenCalledOnce();
  });
});

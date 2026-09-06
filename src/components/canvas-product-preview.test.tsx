import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasProductPreview } from "./canvas-product-preview";
vi.mock("./canvas-product-scene",()=>({default:(props:{imageSrc:string;sizeKey:string;orientation:string})=><div title="Interactive canvas preview" data-image={props.imageSrc} data-size={props.sizeKey} data-orientation={props.orientation}/> }));

describe("CanvasProductPreview", () => {
  it("loads on request and follows the selected artwork, size and orientation", async () => {
    const imageSrc = "/gallery-images/design-one?v=content-hash";
    const { rerender } = render(<CanvasProductPreview imageSrc={imageSrc} sizeKey="a0" orientation="landscape" />);
    expect(screen.queryByTitle("Interactive canvas preview")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "3D View" }));
    expect(await screen.findByTitle("Interactive canvas preview")).toHaveAttribute("data-image",imageSrc);
    expect(screen.getByTitle("Interactive canvas preview")).toHaveAttribute("data-size","a0");
    rerender(<CanvasProductPreview imageSrc="/gallery-images/design-two" sizeKey="a1" orientation="portrait" />);
    expect(screen.getByTitle("Interactive canvas preview")).toHaveAttribute("data-image","/gallery-images/design-two");
    expect(screen.getByTitle("Interactive canvas preview")).toHaveAttribute("data-size","a1");
    expect(screen.getByTitle("Interactive canvas preview")).toHaveAttribute("data-orientation","portrait");
    fireEvent.click(screen.getByRole("button", { name: "Close 3D view" }));
    expect(screen.queryByTitle("Interactive canvas preview")).not.toBeInTheDocument();
  });
  it("lets a design detail page preview its available sizes", async () => {
    render(<CanvasProductPreview imageSrc="/gallery-images/chosen" sizeKey="a0" sizes={["a0","a1","a2"]} orientation="portrait" />);
    fireEvent.click(screen.getByRole("button",{name:"3D View"}));
    await screen.findByTitle("Interactive canvas preview");
    fireEvent.change(screen.getByLabelText("Preview size"),{target:{value:"a1"}});
    expect(screen.getByTitle("Interactive canvas preview")).toHaveAttribute("data-size","a1");
  });
  it("does not invent a model for unsupported sizes", () => {
    render(<CanvasProductPreview imageSrc="/example.jpg" sizeKey="custom" orientation="landscape" />);
    expect(screen.queryByRole("button", { name: "3D View" })).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductConfigurator } from "./product-configurator";
import { getConfigurationSchema } from "@/domain/configuration/schemas";
import { getProductBySlug } from "@/domain/catalogue/products";
vi.mock("./canvas-product-scene",()=>({default:(props:{imageSrc:string;sizeKey:string;orientation:string})=><div title="Interactive canvas preview" data-image={props.imageSrc} data-size={props.sizeKey} data-orientation={props.orientation}/> }));
vi.mock("@/domain/analytics/client",()=>({emitAnalyticsEvent:vi.fn()}));
describe("canvas preview integration",()=>{
  it("uses the selected gallery design and follows the existing purchase selections",async()=>{
    const product=getProductBySlug("digital-oil-painting-canvas")!;
    render(<ProductConfigurator product={product} schema={getConfigurationSchema(product.key)!} orderDate="2026-09-06" initialSizeKey="a0" selectedDesign={{id:"a".repeat(64),title:"Chosen design",altText:"Chosen design",imageUrl:"/gallery-images/chosen?v=original",contentHash:"original",productSlug:"digital-oil-painting-canvas",width:1190,height:840}}/>);
    fireEvent.click(screen.getByRole("button",{name:"3D View"}));
    expect(await screen.findByTitle("Interactive canvas preview")).toHaveAttribute("data-image","/gallery-images/chosen?v=original");
    fireEvent.click(screen.getByRole("radio",{name:/^A1 /}));
    fireEvent.click(screen.getByLabelText("Portrait"));
    expect(screen.getByTitle("Interactive canvas preview")).toHaveAttribute("data-size","a1");
    expect(screen.getByTitle("Interactive canvas preview")).toHaveAttribute("data-orientation","portrait");
    fireEvent.click(screen.getByRole("button",{name:"Close 3D view"}));
    expect(screen.getByRole("button",{name:"View full image"})).toBeInTheDocument();
  });
  it("does not add canvas geometry to banners",()=>{
    const product=getProductBySlug("roll-up-banner")!;
    render(<ProductConfigurator product={product} schema={getConfigurationSchema(product.key)!} orderDate="2026-09-06"/>);
    expect(screen.queryByRole("button",{name:"3D View"})).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductConfigurator } from "./product-configurator";
import { getConfigurationSchema } from "@/domain/configuration/schemas";
import { getProductBySlug } from "@/domain/catalogue/products";
vi.mock("./fabric-banner-scene", () => ({ default: ({ imageSrc, width, height }: { imageSrc: string; width: number; height: number }) => <div title="Fabric preview" data-image={imageSrc} data-width={width} data-height={height} /> }));
vi.mock("@/domain/analytics/client", () => ({ emitAnalyticsEvent: vi.fn() }));
describe("fabric banner artwork binding", () => {
  it.each([["custom-themed-wall-banner","wall"],["digital-oil-painting-banner","oil"],["grave-cover","grave"]])("binds %s default and preserves selected designs",async(slug,file)=>{
    const product=getProductBySlug(slug)!;
    const props={product,schema:getConfigurationSchema(product.key)!,orderDate:"2026-09-08"};
    const {rerender}=render(<ProductConfigurator {...props}/>);
    fireEvent.click(screen.getByRole("button",{name:"3D View"}));
    expect(await screen.findByTitle("Fabric preview")).toHaveAttribute("data-image",`/fabric-banner-3d/${file}.avif`);
    const design={id:"a".repeat(64),title:"Selected",altText:"Selected",imageUrl:"/gallery-images/selected?v=original",contentHash:"original",productSlug:slug === "grave-cover" ? "grave-cover" as const : "custom-themed-wall-banner" as const,width:1200,height:600};
    rerender(<ProductConfigurator {...props} selectedDesign={design}/>);
    expect(await screen.findByTitle("Fabric preview")).toHaveAttribute("data-image",design.imageUrl);
    rerender(<ProductConfigurator {...props} selectedDesign={{...design,imageUrl:"/gallery-images/second?v=2"}}/>);
    expect(await screen.findByTitle("Fabric preview")).toHaveAttribute("data-image","/gallery-images/second?v=2");
  });
});

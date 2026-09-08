import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductConfigurator } from "./product-configurator";
import { getConfigurationSchema } from "@/domain/configuration/schemas";
import { getProductBySlug } from "@/domain/catalogue/products";
vi.mock("./canvas-product-scene",()=>({default:(props:{imageSrc:string;sizeKey:string;orientation:string})=><div title="Interactive canvas preview" data-image={props.imageSrc} data-size={props.sizeKey} data-orientation={props.orientation}/> }));
vi.mock("@/domain/analytics/client",()=>({emitAnalyticsEvent:vi.fn()}));
describe("canvas preview integration",()=>{
  afterEach(()=>vi.unstubAllGlobals());
  it.each([["photo-print-canvas","photo-print"],["digital-oil-painting-canvas","digital-oil"],["custom-themed-canvas","custom-themed"]])("uses the supplied artwork only in %s 3D",async(slug,asset)=>{
    const product=getProductBySlug(slug)!;
    render(<ProductConfigurator product={product} schema={getConfigurationSchema(product.key)!} orderDate="2026-09-06"/>);
    const original=within(screen.getByRole("region",{name:"Artwork preview"})).getByRole("img");
    expect(original.getAttribute("src")).toContain(encodeURIComponent(product.image.src));
    fireEvent.click(screen.getByRole("button",{name:"3D View"}));
    expect(await screen.findByTitle("Interactive canvas preview")).toHaveAttribute("data-image",`/canvas-3d/${asset}-artwork.avif`);
    fireEvent.click(screen.getByRole("button",{name:"Close 3D view"}));
    expect(within(screen.getByRole("region",{name:"Artwork preview"})).getByRole("img").getAttribute("src")).toContain(encodeURIComponent(product.image.src));
  });
  it.each([[840,1190,"portrait","21 × 29.7"],[1190,840,"landscape","29.7 × 21"]] as const)("defaults the product page and 3D to a %s × %s design",async(width,height,orientation,dimensions)=>{
    const product=getProductBySlug("digital-oil-painting-canvas")!;
    render(<ProductConfigurator product={product} schema={getConfigurationSchema(product.key)!} orderDate="2026-09-06" selectedDesign={{id:"a".repeat(64),title:"Chosen",altText:"Chosen",imageUrl:"/gallery-images/chosen",contentHash:"original",productSlug:"digital-oil-painting-canvas",width,height}}/>);
    expect(screen.getByRole("radio",{name:orientation==="portrait"?"Portrait":"Landscape"})).toBeChecked();
    expect(within(screen.getByRole("complementary",{name:"Order summary"})).getByText(`A4 — ${dimensions} cm`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"3D View"}));
    expect(await screen.findByTitle("Interactive canvas preview")).toHaveAttribute("data-orientation",orientation);
  });
  it.each([false,true])("reads unlabelled artwork dimensions without replacing a manual choice (%s)",async(manual)=>{
    const pending:{onload:(()=>void)|null;naturalWidth:number;naturalHeight:number}={onload:null,naturalWidth:840,naturalHeight:1190};
    const loadImage=vi.fn(function(){return pending;});
    vi.stubGlobal("Image",loadImage);
    const baseProduct=getProductBySlug("digital-oil-painting-canvas")!;
    const product={...baseProduct,key:"canvas-without-a-default-example"};
    render(<ProductConfigurator product={product} schema={getConfigurationSchema(baseProduct.key)!} orderDate="2026-09-06"/>);
    // Open 3D before the image finishes loading: detection must survive hiding the 2D image.
    fireEvent.click(screen.getByRole("button",{name:"3D View"}));
    await screen.findByTitle("Interactive canvas preview");
    if(manual){
      fireEvent.click(screen.getByRole("radio",{name:"Landscape"}));
    }
    expect(loadImage).toHaveBeenCalledOnce();
    act(()=>pending.onload?.());
    expect(screen.getByTitle("Interactive canvas preview")).toHaveAttribute("data-orientation",manual?"landscape":"portrait");
    expect(screen.getByRole("radio",{name:manual?"Landscape":"Portrait"})).toBeChecked();
  });

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
    expect(screen.queryByTitle("Interactive canvas preview")).not.toBeInTheDocument();
  });
});

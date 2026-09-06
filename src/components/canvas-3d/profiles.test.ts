import { describe, expect, it } from "vitest";
import { getCanvasProfile } from "./profiles";

describe("measured canvas profiles", () => {
  it("uses the measured A0 dimensions and cross braces", () => {
    expect(getCanvasProfile("a0", "landscape")).toEqual({width:1.19,height:.84,depth:.03,railWidth:.035,braceWidth:.04,braceDepth:.015,braces:"cross"});
  });
  it.each([['a1', .841, .594, 'single'],['a2', .594,.42,'none'],['a3',.42,.297,'none'],['a4',.297,.21,'none']] as const)("maps %s to the right structure", (size,width,height,braces) => {
    expect(getCanvasProfile(size,"landscape")).toMatchObject({width,height,depth:.03,braces});
    expect(getCanvasProfile(size,"portrait")).toMatchObject({width:height,height:width,braces});
  });
  it("rejects unknown sizes",()=>expect(getCanvasProfile("standard","landscape")).toBeNull());
});

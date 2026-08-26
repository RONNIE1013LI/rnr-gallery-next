import nextConfig from "../../next.config";

export const productionImageWidths = [
  ...(nextConfig.images?.imageSizes ?? []),
  ...(nextConfig.images?.deviceSizes ?? []),
].sort((left, right) => left - right);

function evaluateLength(value: string, viewportWidth: number): number {
  const expression = value
    .replace(/^calc\((.*)\)$/, "$1")
    .replace(/([\d.]+)vw/g, (_, number: string) => String((Number(number) / 100) * viewportWidth))
    .replace(/([\d.]+)rem/g, (_, number: string) => String(Number(number) * 16))
    .replace(/([\d.]+)px/g, "$1");
  const tokens = expression.match(/[\d.]+|[()+\-*/]/g) ?? [];
  let cursor = 0;

  function factor(): number {
    const token = tokens[cursor++];
    if (token === "(") {
      const result = sum();
      if (tokens[cursor++] !== ")") throw new Error(`Invalid image size: ${value}`);
      return result;
    }
    const result = Number(token);
    if (!Number.isFinite(result)) throw new Error(`Invalid image size: ${value}`);
    return result;
  }

  function product(): number {
    let result = factor();
    while (tokens[cursor] === "*" || tokens[cursor] === "/") {
      const operator = tokens[cursor++];
      const operand = factor();
      result = operator === "*" ? result * operand : result / operand;
    }
    return result;
  }

  function sum(): number {
    let result = product();
    while (tokens[cursor] === "+" || tokens[cursor] === "-") {
      const operator = tokens[cursor++];
      const operand = product();
      result = operator === "+" ? result + operand : result - operand;
    }
    return result;
  }

  const result = sum();
  if (cursor !== tokens.length) throw new Error(`Invalid image size: ${value}`);
  return result;
}

export function declaredImageWidth(image: HTMLElement, viewportWidth: number): number {
  const sizes = image.getAttribute("sizes");
  if (!sizes) throw new Error("Image does not declare sizes");
  for (const branch of sizes.split(", ")) {
    const conditional = branch.match(/^\(max-width: (\d+)px\) (.+)$/);
    if (conditional) {
      if (viewportWidth <= Number(conditional[1])) {
        return evaluateLength(conditional[2], viewportWidth);
      }
      continue;
    }
    return evaluateLength(branch, viewportWidth);
  }
  throw new Error(`No matching image size for ${viewportWidth}px`);
}

export function productionCandidateFor(
  image: HTMLElement,
  viewportWidth: number,
  devicePixelRatio = 2,
): number {
  const requiredWidth = declaredImageWidth(image, viewportWidth) * devicePixelRatio;
  return productionImageWidths.find((width) => width >= requiredWidth)
    ?? productionImageWidths[productionImageWidths.length - 1];
}

export function generatedSrcsetDescriptors(image: HTMLElement): string[] {
  return (image.getAttribute("srcset") ?? "")
    .split(", ")
    .map((candidate) => candidate.trim().split(" ").at(-1) ?? "")
    .filter(Boolean);
}

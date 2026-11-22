import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownDescription } from "./markdown-description";

const render = (md: string) =>
  renderToStaticMarkup(createElement(MarkdownDescription, null, md));

describe("MarkdownDescription", () => {
  it("renderiza markdown normal", () => {
    expect(render("**hola**")).toContain("<strong>hola</strong>");
  });

  it("no inserta etiquetas <script>", () => {
    expect(render("<script>alert(1)</script>")).not.toContain("<script");
  });

  it("no inserta HTML crudo con handlers", () => {
    const html = render("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<img");
  });

  it("neutraliza links javascript:", () => {
    expect(render("[click](javascript:alert(1))")).not.toContain("javascript:");
  });
});
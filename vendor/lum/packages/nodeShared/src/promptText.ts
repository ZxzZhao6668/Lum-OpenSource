import type { AnyTagProps } from "x-sender";

/** Persist stable source IDs instead of reference numbers or temporary preview URLs. */
export function referencePromptModel(text: string, references: {id: string; value: string; label?: string; name?: string}[]): AnyTagProps[][] {
  return text.split("\n").map(line => line.split(/(\{\{ref \d+\}\})/g).map(part => {
    const reference = references.find(item => item.value === part);
    if (!reference) return {type: "Write", text: part};
    const tag = document.createElement("span");
    tag.className = "imageReference";
    tag.dataset.referenceId = reference.id;
    tag.dataset.value = reference.value;
    tag.textContent = reference.label || reference.name || reference.value;
    return {type: "Custom", html: `<span style="display: inline-block;">${tag.outerHTML}</span>`};
  }));
}

export function getPromptText(value: AnyTagProps[][], resolveReference?: (id: string) => string) {
  return value.map(line => line.map(tag => {
    if (tag.type === "Write") return tag.text;
    if (tag.type === "Input") return tag.text || tag.placeholder;
    if (tag.type !== "Custom") {
      const prefix = tag.type === "Mention" ? "@" : tag.type === "Trigger" ? tag.key : "";
      return prefix + tag.name;
    }
    const content = document.createElement("template");
    content.innerHTML = tag.html;
    for (const reference of content.content.querySelectorAll<HTMLElement>(".imageReference[data-value]")) {
      const id = reference.dataset.referenceId;
      reference.replaceWith(id && resolveReference ? resolveReference(id) : reference.dataset.value ?? "");
    }
    return content.content.textContent ?? "";
  }).join("")).join("\n");
}

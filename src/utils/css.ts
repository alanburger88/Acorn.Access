export function setCSSVar(
  name: string,
  value: string,
  element: HTMLElement = document.documentElement
): void {
  element.style.setProperty(`--aa-${name}`, value);
}

export function removeCSSVar(
  name: string,
  element: HTMLElement = document.documentElement
): void {
  element.style.removeProperty(`--aa-${name}`);
}

export function setDataAttr(
  name: string,
  value: string | boolean,
  element: HTMLElement = document.documentElement
): void {
  if (value === false) {
    element.removeAttribute(`data-aa-${name}`);
  } else {
    element.setAttribute(`data-aa-${name}`, value === true ? '' : value);
  }
}

export function removeDataAttr(
  name: string,
  element: HTMLElement = document.documentElement
): void {
  element.removeAttribute(`data-aa-${name}`);
}

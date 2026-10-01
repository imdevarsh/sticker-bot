import type { Checkboxes } from "@slack/types";

const option = {
  text: { type: "plain_text" as const, text: "67ify — animate this sticker" },
  value: "67",
};

export function stickerEffectCheckbox(selected = false): Checkboxes {
  return {
    type: "checkboxes",
    action_id: "sticker_effect",
    options: [option],
    ...(selected ? { initial_options: [option] } : {}),
  };
}

// Slack includes the current checkbox state with size-button clicks and modal submissions.
export function wants67(state?: {
  values: Record<
    string,
    Record<string, { selected_options?: { value?: string }[] | null }>
  >;
}): boolean {
  return (
    state?.values.sticker_effect?.sticker_effect?.selected_options?.some(
      (option) => option.value === "67",
    ) ?? false
  );
}

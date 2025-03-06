export const AI_PROMPTS = {
  CSS_EXPERT: 'You are a CSS expert focused on transforming existing CSS while preserving structure, variable names, and optimizing for accessibility and performance.',
  STYLE_RULES: `Rules:
1. Only modify variable values
2. Keep all --vibe-* names unchanged
3. Maintain RGB format where used
4. Ensure color contrast
5. Keep existing variable relationships

Return only the :root {...} section.`,
} as const;

import skillMd from '../skills/l2b/SKILL.md' with { type: 'text' };

/** The agent skill, keyed by path inside the skill directory. Text imports are embedded in compiled binaries. */
export const SKILL_FILES: Record<string, string> = {
  'SKILL.md': skillMd,
};

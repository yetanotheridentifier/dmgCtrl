export function resolveXwsName(slug: string, map: Record<string, string>): string {
  return map[slug] ?? slug
}

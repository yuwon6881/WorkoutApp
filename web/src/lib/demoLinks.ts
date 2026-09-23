const abbreviations: Record<string, string> = {
  db: 'dumbbell', dbs: 'dumbbell', bb: 'barbell', kb: 'kettlebell',
  ez: 'ez bar', sm: 'smith machine', bw: 'bodyweight', cbl: 'cable',
  ohp: 'overhead press', rdl: 'romanian deadlift', sldl: 'stiff leg deadlift',
  gm: 'good morning', bor: 'bent over row', dl: 'deadlift'
};

export function demoNameKey(name: string): string {
  const words = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/\b(pull|push|chin|sit|step|hang|warm) (ups?|downs?)\b/g, '$1$2');
  return words.split(/\s+/).map(word => abbreviations[word] ?? word).join(' ');
}

export function demoUrlForName(links: Record<string, string> | null | undefined, name: string): string | null {
  return links?.[demoNameKey(name)] ?? null;
}

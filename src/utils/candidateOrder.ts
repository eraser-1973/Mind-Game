export function shuffleCandidateIds(
  candidateIds: string[],
  random: () => number = Math.random,
): string[] {
  const shuffled = [...candidateIds]

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ]
  }

  return shuffled
}

import type { Demand, Repository } from './api'

/** Returns Workspace repositories that have not yet been isolated for a Demand. */
export function repositoriesNotInDemand(repositories: Repository[], demand: Demand | null): Repository[] {
  const included = new Set(demand?.repositories.map(repository => repository.id) ?? [])
  return repositories.filter(repository => !included.has(repository.id))
}

/** Searches the fields a user can recognize when choosing repositories for a Demand. */
export function filterDemandRepositories(repositories: Repository[], query: string): Repository[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return repositories
  return repositories.filter((repository) => [repository.name, repository.path, repository.defaultRef ?? '']
    .join(' ')
    .toLocaleLowerCase()
    .includes(normalizedQuery))
}

// Things Home can ask a freshly opened notebook to do straight away.
export type StartAction = { type: 'pdf'; file: File } | { type: 'ask' }

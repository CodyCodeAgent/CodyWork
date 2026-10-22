import { describe, expect, it } from 'vitest'
import { parseFluxCollaborationUrl } from '../src/services/fluxBindings.js'

describe('Flux collaboration URL parsing', () => {
  it('extracts the stable binding and optional preview task from a home URL', () => {
    expect(parseFluxCollaborationUrl('https://flux.bytedance.net/home/91115103721654403/collaboration/95455704273397855?view=files&tab=chat&preview_task=95458484711183219')).toEqual({
      deliveryId: '95455704273397855',
      spaceId: '91115103721654403',
      url: 'https://flux.bytedance.net/home/91115103721654403/collaboration/95455704273397855?view=files&tab=chat&preview_task=95458484711183219',
      previewTaskId: '95458484711183219',
    })
  })

  it('accepts the team URL form and an omitted binding', () => {
    expect(parseFluxCollaborationUrl('https://flux.bytedance.net/team/sp-1/collaboration/delivery_2')).toMatchObject({ spaceId: 'sp-1', deliveryId: 'delivery_2', previewTaskId: null })
    expect(parseFluxCollaborationUrl('   ')).toBeNull()
    expect(parseFluxCollaborationUrl(undefined)).toBeNull()
  })

  it('accepts the Bits surface and canonicalizes navigation metadata', () => {
    expect(parseFluxCollaborationUrl('https://bits.bytedance.net/flux/home/sp-1/collaboration/delivery-2?tab=chat&utm_source=test#details')).toEqual({
      deliveryId: 'delivery-2',
      spaceId: 'sp-1',
      url: 'https://flux.bytedance.net/home/sp-1/collaboration/delivery-2?tab=chat',
      previewTaskId: null,
    })
  })

  it('rejects other hosts, malformed paths, credentials and invalid task ids', () => {
    expect(() => parseFluxCollaborationUrl('https://example.com/home/1/collaboration/2')).toThrow('Bits Flux')
    expect(() => parseFluxCollaborationUrl('https://flux.bytedance.net:444/home/1/collaboration/2')).toThrow('HTTPS 协作链接')
    expect(() => parseFluxCollaborationUrl('https://flux.bytedance.net/task/2')).toThrow('协作 ID')
    expect(() => parseFluxCollaborationUrl('https://user:secret@flux.bytedance.net/home/1/collaboration/2')).toThrow('HTTPS 协作链接')
    expect(() => parseFluxCollaborationUrl('https://flux.bytedance.net/home/1/collaboration/2?preview_task=bad/value')).toThrow('preview_task')
    expect(() => parseFluxCollaborationUrl('https://bits.bytedance.net/home/1/collaboration/2')).toThrow('协作 ID')
  })
})

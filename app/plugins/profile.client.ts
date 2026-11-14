import { useProfileStore } from '~/stores/profile'

/** Loads the persisted student profile once the app runs in the browser. */
export default defineNuxtPlugin(() => {
  useProfileStore().hydrate()
})

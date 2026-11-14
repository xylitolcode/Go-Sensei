import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  // Port 3000 is occupied by the local LLM gateway (NUXT_LLM_BASE_URL), so the
  // app lives on 4000. Keeping them apart also stops the app from calling itself.
  devServer: { port: 4000 },
  css: ['~/assets/css/main.css'],
  modules: ['@pinia/nuxt'],
  runtimeConfig: {
    llm: {
      // Placeholder on purpose: the app must never call itself. Override with
      // NUXT_LLM_BASE_URL (see .env.example) before enabling the model.
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-flash',
      timeoutMs: 20000
    },
    katago: {
      // Empty by default: KataGo is an optional native engine. Set the three
      // paths via NUXT_KATAGO_* to turn on real MCTS analysis (see README).
      binary: '',
      config: '',
      model: '',
      // Optional human-SL net for rank-based opponent play (see README).
      humanModel: '',
      maxVisits: 200,
      timeoutMs: 25000,
      // 0 = auto-calibrate ownership sign against stones on the board.
      ownershipSign: 0,
      // The generated analysis.cfg must set reportAnalysisWinratesAs = BLACK.
      winrateAsBlack: true
    }
  },
  vite: {
    plugins: [tailwindcss()]
  },
  app: {
    head: {
      title: 'Go Sensei · Learn Go on 13×13',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content: 'A friendly, step-by-step Go learning board for absolute beginners.'
        }
      ]
    }
  }
})

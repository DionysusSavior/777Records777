import { Heading, Text } from "@medusajs/ui"

const Hero = () => {
  const panels = [
    {
      title: "Clothes",
      description: "Editorial drops, collaborations, and limited runs.",
    },
    {
      title: "Sounds",
      description: "Studio sessions, cuts, and curated releases.",
    },
    {
      title: "Features",
      description: "Spotlights, stories, and behind-the-scenes access.",
    },
  ]

  return (
    <div className="relative min-h-[calc(100vh-96px)] w-full overflow-hidden border-b border-ui-border-base bg-gradient-to-br from-black via-gray-900 to-gray-800 text-white">
      <div className="absolute inset-0 opacity-25 bg-[radial-gradient(circle_at_top_left,_#ffffff20,_transparent_35%)]" />

      <div className="relative z-10 flex min-h-[calc(100vh-96px)] flex-col items-center justify-center gap-16 px-6 pb-16 pt-8 text-center">
        <div className="grid w-full max-w-6xl gap-6 md:grid-cols-3">
          {panels.map((panel) => (
            <div
              key={panel.title}
              className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/5 px-8 py-56 text-left transition-transform duration-300 ease-out hover:-translate-y-1 hover:border-white/30 hover:bg-white/10"
            >
              <div className="absolute inset-0 scale-110 bg-gradient-to-br from-white/10 via-transparent to-white/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              <Heading
                level="h3"
                className="relative text-xl font-semibold text-white animate-pulse-slow"
              >
                {panel.title}
              </Heading>
              <Text className="relative mt-3 text-sm text-white/80 animate-pulse-slow">
                {panel.description}
              </Text>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Hero

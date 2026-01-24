import repeat from "@lib/util/repeat"

const SkeletonCartPage = () => {
  return (
    <div className="py-12">
      <div className="content-container">
        <div className="grid grid-cols-1">
          <div className="glass-panel rounded-3xl px-6 py-8">
            <div className="flex items-center justify-between">
              <div className="h-8 w-24 rounded-md bg-white/10 animate-pulse" />
              <div className="h-5 w-16 rounded-md bg-white/10 animate-pulse" />
            </div>
            <div className="mt-6 flex flex-col gap-4">
              {repeat(3).map((index) => (
                <div
                  key={index}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-20 w-20 rounded-xl bg-white/10 animate-pulse" />
                      <div className="flex flex-col gap-2">
                        <div className="h-4 w-40 rounded-md bg-white/10 animate-pulse" />
                        <div className="h-3 w-28 rounded-md bg-white/10 animate-pulse" />
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-16 rounded-md bg-white/10 animate-pulse" />
                      <div className="h-4 w-10 rounded-md bg-white/10 animate-pulse" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 h-12 w-full rounded-md bg-white/10 animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default SkeletonCartPage

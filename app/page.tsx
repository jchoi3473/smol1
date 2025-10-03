import dynamic from 'next/dynamic'

const ImageGenerator = dynamic(() => import('./components/ImageGenerator'), {
  ssr: false,
  loading: () => <p className="text-sm text-neutral-600 dark:text-neutral-300">Loading image tools…</p>,
})

export default function Page() {
  return (
    <section>
      <h1 className="mb-8 text-2xl font-semibold tracking-tighter">
        Smol1 on Bonk
      </h1>
      <p className="mb-4">
        {`Smol 1 website under development. In the meantime, have fun with the image generator!`}
      </p>

      {/* Placeholder for image generator */}
      <div className="mt-12">
        <ImageGenerator />
      </div>
    </section>
  )
}

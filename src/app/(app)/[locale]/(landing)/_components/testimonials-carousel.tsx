'use client'

import { useRef } from 'react'
import Image from 'next/image'
import Autoplay from 'embla-carousel-autoplay'
import { Text } from '@/components/ui/text'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel'

type Testimonial = {
  quote: string
  name: string
  handle: string
  avatar: string
}

export function TestimonialsCarousel({
  title,
  items,
}: {
  title: string
  items: readonly Testimonial[]
}) {
  const autoplay = useRef(
    Autoplay({ delay: 3000, stopOnInteraction: false, stopOnMouseEnter: true }),
  )

  return (
    <Carousel
      opts={{ align: 'start', loop: true }}
      plugins={[autoplay.current]}
      className="mt-12 sm:mt-16 lg:mt-[100px]"
    >
      <div className="flex items-end justify-between gap-6">
        <Text as="h2" variant="h3" className="text-zinc-950 lg:h-[49px]">
          {title}
        </Text>
        <div className="relative flex shrink-0 gap-3">
          <CarouselPrevious className="static translate-y-0 size-10" />
          <CarouselNext className="static translate-y-0 size-10" />
        </div>
      </div>

      <CarouselContent className="mt-10 -ml-5 sm:mt-12 lg:mt-16">
        {items.map((testimonial) => (
          <CarouselItem
            key={testimonial.name}
            className="pl-5 sm:basis-1/2 lg:basis-1/3"
          >
            <article className="flex h-full flex-col rounded-2xl border-[0.5px] border-zinc-200 p-6 lg:p-8">
              <Text variant="body-default" className="text-zinc-700">
                {testimonial.quote}
              </Text>
              <div className="mt-[30px] flex items-center gap-5 pt-[30px] lg:mt-auto">
                <Image
                  src={testimonial.avatar}
                  alt=""
                  width={50}
                  height={50}
                  quality={90}
                  sizes="50px"
                  className="size-[50px] rounded-full object-cover"
                />
                <div>
                  <Text variant="body-default" className="text-zinc-950">
                    {testimonial.name}
                  </Text>
                  <Text variant="body-small" className="text-zinc-500">
                    {testimonial.handle}
                  </Text>
                </div>
              </div>
            </article>
          </CarouselItem>
        ))}
      </CarouselContent>
    </Carousel>
  )
}

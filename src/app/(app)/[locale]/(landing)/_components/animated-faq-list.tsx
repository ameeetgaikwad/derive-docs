'use client'

import { useState } from 'react'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import { Plus, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'

type FaqItem = {
  question: string
  answer: string
}

export function AnimatedFaqList({ items }: { items: FaqItem[] }) {
  const [openItems, setOpenItems] = useState(
    () => new Set([items[0]?.question]),
  )

  const toggleItem = (question: string) => {
    setOpenItems((current) => {
      const next = new Set(current)
      if (next.has(question)) {
        next.delete(question)
      } else {
        next.add(question)
      }
      return next
    })
  }

  return (
    <div className="flex flex-col lg:mt-[17px]">
      {items.map((faq, index) => {
        const isOpen = openItems.has(faq.question)

        return (
          <div
            key={faq.question}
            className={cn(
              'border-b-[0.5px] border-zinc-200',
              index === 0 ? 'pb-[50px]' : 'py-[50px]',
            )}
          >
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => toggleItem(faq.question)}
              className="flex w-full cursor-pointer items-start justify-between gap-[30px] text-left"
            >
              <Text as="h3" variant="h5" className="text-zinc-800">
                {faq.question}
              </Text>
              <span
                className={cn(
                  'grid size-[35px] shrink-0 place-items-center transition-colors duration-200',
                  isOpen ? 'text-red-500' : 'text-green-500',
                )}
              >
                {isOpen ? (
                  <X className="size-8" />
                ) : (
                  <Plus className="size-8" />
                )}
              </span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen ? (
                <motion.div
                  key="answer"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <Text
                    variant="body-large"
                    className="mt-[15px] max-w-[608px] text-zinc-500"
                  >
                    {faq.answer}
                  </Text>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}

import { useState } from 'react';
import { motion } from 'framer-motion';
import { PlayCircleIcon } from '@heroicons/react/24/solid';

export default function VideoSection() {
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <section className="section-padding bg-white">
      <div className="container-max">
        <div className="max-w-4xl mx-auto">
          {/* Section Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center mb-12"
          >
            <h2 className="heading-2 text-heading mb-4">
              Hear From a Business Owner Just Like You
            </h2>
            <p className="text-text-secondary text-lg">
              Mike's story isn't unique—it's the story of thousands of business owners who
              found a better path to funding.
            </p>
          </motion.div>

          {/* Video Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="relative aspect-video rounded-2xl overflow-hidden bg-midnight-blue shadow-xl"
          >
            {!isPlaying ? (
              /* Video Thumbnail/Placeholder */
              <div className="absolute inset-0 bg-gradient-to-br from-midnight-blue to-deep-sea">
                {/* Background Pattern */}
                <div className="absolute inset-0 opacity-10">
                  <div className="absolute top-1/4 right-1/4 w-64 h-64 bg-mint-green rounded-full blur-3xl" />
                  <div className="absolute bottom-1/4 left-1/4 w-64 h-64 bg-ocean-blue rounded-full blur-3xl" />
                </div>

                {/* Content */}
                <div className="absolute inset-0 flex flex-col items-center justify-center p-8">
                  {/* Profile */}
                  <div className="w-20 h-20 rounded-full bg-ocean-blue/50 border-4 border-white/20 flex items-center justify-center mb-4">
                    <span className="text-white text-2xl font-bold">MC</span>
                  </div>
                  <p className="text-white font-semibold text-lg mb-1">Mike Chen</p>
                  <p className="text-white/60 text-sm mb-8">Construction Business Owner</p>

                  {/* Play Button */}
                  <button
                    onClick={() => setIsPlaying(true)}
                    className="group flex items-center gap-3 bg-mint-green hover:bg-mint-green/90 text-midnight-blue
                             font-semibold px-6 py-3 rounded-full transition-all hover:scale-105"
                    aria-label="Play video"
                  >
                    <PlayCircleIcon className="w-8 h-8" />
                    <span>Watch Mike's Story</span>
                  </button>

                  {/* Duration */}
                  <p className="text-white/40 text-sm mt-4">1:30</p>
                </div>
              </div>
            ) : (
              /* Video Player Placeholder */
              <div className="absolute inset-0 flex items-center justify-center bg-black">
                <p className="text-white/60 text-center px-8">
                  Video player would be embedded here.
                  <br />
                  <span className="text-sm">
                    (Integration with video hosting service like Vimeo or YouTube)
                  </span>
                </p>
              </div>
            )}
          </motion.div>

          {/* Quote Below Video */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="text-center mt-8"
          >
            <p className="text-text-secondary italic max-w-2xl mx-auto">
              "Today, I'm not just a guy trying to survive. I'm a business owner again.
              I'm thinking about growth. About the future."
            </p>
          </motion.div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="text-center mt-8"
          >
            <a href="#apply" className="btn-primary">
              Apply Now - It's Free
            </a>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

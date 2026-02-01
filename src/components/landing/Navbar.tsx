import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Bars3Icon, XMarkIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import Logo from '../ui/Logo';
import ThemeToggle from '../ui/ThemeToggle';
import { useTheme } from '../../lib/theme-context';
import { useSession } from '../../context/SessionContext';
import { useUserProfile } from '../../context/UserProfileContext';
import supabase from '../../supabase';

const navLinks = [
  { name: 'Funding Options', href: '#features' },
  { name: 'How It Works', href: '#how-it-works' },
  { name: 'Success Stories', href: '#case-study' },
  { name: 'Security', href: '#security' },
];

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { theme } = useTheme();
  const { session } = useSession();
  const { isAdmin, profile } = useUserProfile();
  const navigate = useNavigate();

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  return (
    <motion.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={`fixed top-0 left-0 right-0 z-[1000] transition-all duration-500 ${
        isScrolled
          ? theme === 'dark'
            ? 'bg-midnight-blue/90 backdrop-blur-lg shadow-lg border-b border-white/10'
            : 'bg-white/90 backdrop-blur-lg shadow-lg border-b border-gray-100/50'
          : 'bg-transparent'
      }`}
    >
      <div className="container-max">
        <div className="flex items-center justify-between h-20 lg:h-20 md:h-16">
          {/* Logo */}
          <Link to="/">
            <Logo
              variant="full"
              size="md"
              theme={isScrolled && theme === 'light' ? 'light' : 'dark'}
            />
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center gap-8">
            {navLinks.map((link, index) => (
              <motion.a
                key={link.name}
                href={link.href}
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + index * 0.1 }}
                className={`relative text-sm font-medium transition-colors group ${
                  isScrolled && theme === 'light' ? 'text-text-secondary hover:text-midnight-blue' : 'text-white/90 hover:text-white'
                }`}
                whileHover={{ y: -2 }}
              >
                {link.name}
                <motion.span
                  className="absolute -bottom-1 left-0 w-0 h-0.5 bg-mint-green group-hover:w-full transition-all duration-300"
                  style={{ originX: 0 }}
                />
              </motion.a>
            ))}
          </div>

          {/* Desktop CTAs */}
          <div className="hidden lg:flex items-center gap-4">
            <ThemeToggle />
            {session ? (
              <>
                {isAdmin && (
                  <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    <Link
                      to="/admin"
                      className={`flex items-center gap-2 text-sm font-medium transition-colors ${
                        isScrolled && theme === 'light' ? 'text-text-secondary hover:text-midnight-blue' : 'text-white/90 hover:text-white'
                      }`}
                    >
                      <Squares2X2Icon className="w-4 h-4" />
                      Dashboard
                    </Link>
                  </motion.div>
                )}
                <div className="flex items-center gap-3">
                  <span className={`text-sm ${isScrolled && theme === 'light' ? 'text-text-secondary' : 'text-white/70'}`}>
                    {profile?.display_name || profile?.email?.split('@')[0]}
                  </span>
                  <motion.button
                    onClick={handleSignOut}
                    className={`text-sm font-medium transition-colors ${
                      isScrolled && theme === 'light' ? 'text-text-secondary hover:text-midnight-blue' : 'text-white/90 hover:text-white'
                    }`}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    Sign Out
                  </motion.button>
                </div>
              </>
            ) : (
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Link
                  to="/auth/sign-in"
                  className={`text-sm font-medium transition-colors ${
                    isScrolled && theme === 'light' ? 'text-text-secondary hover:text-midnight-blue' : 'text-white/90 hover:text-white'
                  }`}
                >
                  Sign In
                </Link>
              </motion.div>
            )}
            <motion.a
              href="#apply"
              className="relative overflow-hidden bg-gradient-to-r from-mint-green to-teal text-midnight-blue font-semibold text-sm px-6 py-2.5 rounded-lg"
              whileHover={{ scale: 1.05, boxShadow: '0 0 20px rgba(0, 212, 157, 0.4)' }}
              whileTap={{ scale: 0.95 }}
            >
              <motion.span
                className="absolute inset-0 bg-white"
                initial={{ x: '-100%' }}
                whileHover={{ x: '100%' }}
                transition={{ duration: 0.5 }}
                style={{ opacity: 0.2 }}
              />
              <span className="relative z-10">Apply Now</span>
            </motion.a>
          </div>

          {/* Mobile Menu Button */}
          <motion.button
            className="lg:hidden p-2 rounded-lg hover:bg-white/10 transition-colors"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <AnimatePresence mode="wait">
              {isMobileMenuOpen ? (
                <motion.div
                  key="close"
                  initial={{ rotate: -90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: 90, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <XMarkIcon className={`w-6 h-6 ${isScrolled && theme === 'light' ? 'text-midnight-blue' : 'text-white'}`} />
                </motion.div>
              ) : (
                <motion.div
                  key="menu"
                  initial={{ rotate: 90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: -90, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <Bars3Icon className={`w-6 h-6 ${isScrolled && theme === 'light' ? 'text-midnight-blue' : 'text-white'}`} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.button>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className={`lg:hidden backdrop-blur-lg border-t ${
              theme === 'dark'
                ? 'bg-midnight-blue/95 border-white/10'
                : 'bg-white/95 border-gray-100'
            }`}
          >
            <div className="container-max py-6 flex flex-col gap-2">
              {navLinks.map((link, index) => (
                <motion.a
                  key={link.name}
                  href={link.href}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="text-text-secondary font-medium py-3 px-4 rounded-lg hover:bg-mint-green/10 hover:text-midnight-blue transition-all"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {link.name}
                </motion.a>
              ))}
              <hr className="my-2 border-gray-200 dark:border-gray-700" />
              <div className="flex items-center justify-between px-4 py-2">
                <span className="text-text-secondary text-sm">Theme</span>
                <ThemeToggle />
              </div>
              {session ? (
                <>
                  {isAdmin && (
                    <motion.div
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.4 }}
                    >
                      <Link
                        to="/admin"
                        className="flex items-center gap-2 text-text-secondary font-medium py-3 px-4 rounded-lg hover:bg-mint-green/10 hover:text-midnight-blue transition-colors"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        <Squares2X2Icon className="w-5 h-5" />
                        Dashboard
                      </Link>
                    </motion.div>
                  )}
                  <div className="px-4 py-2 text-sm text-text-secondary">
                    Signed in as {profile?.display_name || profile?.email?.split('@')[0]}
                  </div>
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.5 }}
                  >
                    <button
                      onClick={() => {
                        handleSignOut();
                        setIsMobileMenuOpen(false);
                      }}
                      className="block w-full text-left text-text-secondary font-medium py-3 px-4 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      Sign Out
                    </button>
                  </motion.div>
                </>
              ) : (
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 }}
                >
                  <Link
                    to="/auth/sign-in"
                    className="block text-text-secondary font-medium py-3 px-4 rounded-lg hover:bg-gray-100 transition-colors"
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    Sign In
                  </Link>
                </motion.div>
              )}
              <motion.a
                href="#apply"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="bg-gradient-to-r from-mint-green to-teal text-midnight-blue font-semibold text-center py-3 px-4 rounded-lg mt-2"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Apply Now
              </motion.a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}

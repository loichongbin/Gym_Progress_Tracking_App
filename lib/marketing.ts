// Stock imagery for the public landing page only (not user content).
const unsplash = (id: string) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1080&q=75`;

export const LANDING_PHOTOS = [
  "1534438327276-14e5300c3a48", "1583454110551-21f2fa2afe61", "1571019613454-1cb2f99b2d8b", "1526506118085-60ce8714f8c5",
].map(unsplash);

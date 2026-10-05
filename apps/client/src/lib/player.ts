/**
 * <audio> elements a Player keeps for the video's sound. The preview plays every sound (each shot's,
 * each sound effect, the music) through one (see Sound in @vedit/composition), including the ones
 * loading ahead of their moment, and Remotion stops with an error when it runs out.
 */
export const AUDIO_TAGS = 32;

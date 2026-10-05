// The Remotion entry for export: the same composition the editor previews, registered for the renderer.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import {
  type CompositionProps,
  CoverComposition,
  type CoverProps,
  compositionMeta,
  VideoComposition,
} from "@vedit/composition";
import { emptyProject } from "@vedit/project";
import { Composition, registerRoot } from "remotion";

export const COMPOSITION_ID = "Video";

function Root() {
  return (
    <>
      <Composition
        id={COMPOSITION_ID}
        component={VideoComposition}
        defaultProps={
          {
            doc: emptyProject("Untitled"),
            mediaBase: "",
            quality: "export",
            muteSources: true,
          } satisfies CompositionProps
        }
        calculateMetadata={({ props }) => compositionMeta(props.doc)}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={1}
      />
      {/* The cover image: one frame. */}
      <Composition
        id="Cover"
        component={CoverComposition}
        defaultProps={{ doc: emptyProject("Untitled"), mediaBase: "" } satisfies CoverProps}
        calculateMetadata={({ props }) => ({ ...compositionMeta(props.doc), durationInFrames: 1 })}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={1}
      />
    </>
  );
}

registerRoot(Root);

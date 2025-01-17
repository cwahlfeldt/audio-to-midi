import {
  BasicPitch,
  noteFramesToTime,
  addPitchBendsToNoteEvents,
  outputToNotesPoly,
  type NoteEventTime,
} from "@spotify/basic-pitch";
import { Midi } from "@tonejs/midi";

// Type definitions
interface AudioProcessor {
  buffer: ArrayBuffer;
  mono: Float32Array;
}

interface ServerConfig {
  port: number;
}

interface MidiNote {
  midi: number;
  time: number;
  duration: number;
  velocity: number;
}

type ProcessingCallback = (
  frames: number[][],
  onsets: number[][],
  contours: number[][],
) => void;

// Type guard for File object
function isValidAudioFile(file: unknown): file is File {
  if (!(file instanceof File)) return false;
  if (file.size === 0) return false;

  // Just check if it's an audio file by extension
  const validExtensions = [".mp3", ".wav", ".m4a", ".aac"];
  return validExtensions.some(ext => 
    file.name.toLowerCase().endsWith(ext)
  );
}

// Utility function to convert blob to base64
const blobToBase64 = async (blob: Blob): Promise<string> => {
  const arrayBuffer: ArrayBuffer = await blob.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
};

// Convert audio buffer to mono using a simple amplitude-based approach
const processAudioBuffer = async (
  buffer: ArrayBuffer,
): Promise<AudioProcessor> => {
  // Create a view of the buffer as bytes
  const bytes = new Uint8Array(buffer);
  
  // Skip the MP3 header (first 10 bytes are usually header information)
  const dataStart = 10;
  
  // We'll take amplitude values directly from the MP3 data
  // This is a simplified approach that won't give perfect results
  // but should work well enough for basic pitch detection
  const samplesPerChannel = Math.floor((bytes.length - dataStart) / 2);
  const mono = new Float32Array(samplesPerChannel);
  
  for (let i = 0; i < samplesPerChannel; i++) {
    // Take every other byte pair and convert to a normalized float
    const value = (bytes[dataStart + i * 2] << 8) | bytes[dataStart + i * 2 + 1];
    mono[i] = value / 32768.0;
  }

  // Find maximum amplitude using a loop
  let maxAmp = 0;
  for (let i = 0; i < mono.length; i++) {
    const absValue = Math.abs(mono[i]);
    if (absValue > maxAmp) {
      maxAmp = absValue;
    }
  }

  // Normalize values between -1 and 1 if we have a non-zero amplitude
  if (maxAmp > 0) {
    for (let i = 0; i < mono.length; i++) {
      mono[i] = mono[i] / maxAmp;
    }
  }

  return { buffer, mono };
};

// Convert notes to MIDI file
const convertMidiFile = async (notes: NoteEventTime[]): Promise<string> => {
  console.log("Converting notes to MIDI...");
  const midi: Midi = new Midi();
  const track = midi.addTrack();

  console.log("Adding notes to track...");
  notes.forEach((note: NoteEventTime) => {
    // Ensure values are within valid ranges
    const midiNote: MidiNote = {
      midi: Math.min(Math.max(Math.round(note.pitchMidi), 0), 127), // MIDI notes are 0-127
      time: Math.max(note.startTimeSeconds, 0),
      duration: Math.max(note.durationSeconds, 0.1), // Minimum duration of 0.1s
      velocity: Math.min(Math.max(Math.round(note.amplitude * 127), 1), 127), // MIDI velocity is 1-127
    };
    track.addNote(midiNote);
  });

  console.log("Converting to binary...");
  const midiArray: Uint8Array = midi.toArray();
  console.log("MIDI array length:", midiArray.length);
  console.log("First few bytes:", Array.from(midiArray.slice(0, 10)));
  
  // Convert to base64
  return Buffer.from(midiArray).toString('base64');
};

// Process audio buffer and convert to MIDI
const getMidi = async (buffer: ArrayBuffer): Promise<string> => {
  console.log("Starting audio processing...");
  const { mono } = await processAudioBuffer(buffer);
  console.log("Audio processed to mono, length:", mono.length);
  console.log("Sample values:", mono.slice(0, 10));  // Look at first 10 samples

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];

  console.log("Loading basic-pitch model...");
  const MODEL_URL: string =
    "https://unpkg.com/@spotify/basic-pitch@1.0.1/model/model.json";
  const basicPitch: BasicPitch = new BasicPitch(MODEL_URL);

  const processCallback: ProcessingCallback = (f, o, c) => {
    console.log("Got frame batch:", f.length);
    frames.push(...f);
    onsets.push(...o);
    contours.push(...c);
  };

  console.log("Evaluating model...");
  await basicPitch.evaluateModel(mono, processCallback, () => {
    console.log("Progress callback");
  });
  console.log("Model evaluation complete");
  console.log("Frames:", frames.length);
  console.log("Onsets:", onsets.length);
  console.log("Contours:", contours.length);

  const noteEvents: NoteEventTime[] = noteFramesToTime(
    addPitchBendsToNoteEvents(
      contours,
      outputToNotesPoly(frames, onsets, 0.2, 0.2, 5, true),
    ),
  );
  console.log("Note events generated:", noteEvents.length);
  console.log("Sample note event:", noteEvents[0]);

  const midiData = await convertMidiFile(noteEvents);
  console.log("MIDI data length:", midiData.length);
  return midiData;
};

// Error handling
class AudioProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioProcessingError";
  }
}

// Server configuration
const config: ServerConfig = {
  port: 3000,
};

// Server implementation
export const server = Bun.serve({
  port: config.port,
  async fetch(request: Request): Promise<Response> {
    // Handle only POST requests
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      // Then in your server route, replace the file validation part with:
      const formData: FormData = await request.formData();
      const file = formData.get("audio");

      console.log("Received file:", file); // Debug log
      if (file instanceof File) {
        console.log("File details:", {
          name: file.name,
          type: file.type,
          size: file.size,
        });
      }

      // Validate file using type guard
      if (!isValidAudioFile(file)) {
        console.log("File validation failed"); // Debug log
        throw new AudioProcessingError("Invalid or missing MP3 file");
      }

      console.log(
        "Processing file:",
        file.name,
        "Size:",
        file.size,
        "Type:",
        file.type,
      );

      // Convert the file to an ArrayBuffer
      const buffer: ArrayBuffer = await file.arrayBuffer();

      // Process the audio and get the MIDI file
      const midiBase64: string = await getMidi(buffer);

      // Convert base64 back to binary
      const binaryString = atob(midiBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Return the MIDI file as binary
      return new Response(bytes, {
        headers: {
          "Content-Type": "audio/midi",
          "Content-Disposition": `attachment; filename=${file.name.replace(".mp3", ".mid")}`,
        },
      });
    } catch (error) {
      console.error("Error processing file:", error);
      const errorMessage: string =
        error instanceof Error ? error.message : "Unknown error occurred";
      return new Response(errorMessage, {
        status: error instanceof AudioProcessingError ? 400 : 500,
      });
    }
  },
});

console.log(`Server running at http://localhost:${config.port}`);

#!/usr/bin/env python
import sys
import argparse
import markovify

def main():
    parser = argparse.ArgumentParser(description='Generate text using markovify')
    parser.add_argument('--end', type=int, default=25, help='A parameter to potentially control generation (not used in this simple example)')
    args = parser.parse_args()
    
    # Read the entire corpus from stdin
    corpus = sys.stdin.read()
    
    if not corpus.strip():
        sys.exit("Error: No input text provided.")
    
    try:
        text_model = markovify.Text(corpus, state_size=2)
        # Try to generate a sentence; you can adjust the tries value if necessary
        sentence = text_model.make_sentence(tries=100)
        
        # If generation fails, you might fall back to making a short sentence
        if sentence is None:
            sentence = text_model.make_short_sentence(140)
        
        # Print the generated sentence (this goes to stdout and will be captured by Node)
        if sentence:
            print(sentence)
        else:
            print("")
    except Exception as e:
        sys.exit(f"Error generating text: {e}")

if __name__ == '__main__':
    main()

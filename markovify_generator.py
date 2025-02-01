#!/usr/bin/env python
import sys
import argparse
import markovify
import random

def main():
    parser = argparse.ArgumentParser(description='Generate text using markovify')
    parser.add_argument('--end', type=int, default=25, help='Not used in this example, but available for extension')
    args = parser.parse_args()
    
    # Read the entire corpus from stdin
    corpus = sys.stdin.read()
    
    if not corpus.strip():
        sys.exit("Error: No input text provided.")
    
    # Ensure a random seed based on the current time (or OS randomness)
    random.seed()
    
    try:
        # Use a state size of 3 for a more context-aware model
        text_model = markovify.Text(corpus, state_size=2)
        
        # Attempt to generate a sentence; increase tries for a more diverse output
        sentence = text_model.make_sentence(tries=200)
        
        # If no sentence is generated, try a shorter version
        if sentence is None:
            sentence = text_model.make_short_sentence(140)
        
        print(sentence if sentence else "")
    except Exception as e:
        sys.exit(f"Error generating text: {e}")

if __name__ == '__main__':
    main()

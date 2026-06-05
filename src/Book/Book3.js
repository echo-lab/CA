export const data = [
  {
    Book: {
      id: 1,
      Name: "Pattern Pals: Levels in the Library",
      Characters: [
        {Name:"Narrator", img: require("../Pictures/narrator.png")},
        {Name:"Clara",img: require("../Pictures/book1/Clara_avatar.jpg")},
        {Name:"Zoe",img: require("../Pictures/book1/Zoe_avatar.jpg")},
      ],

      Pages: {
        Cover: {
          img: require("../Pictures/book3/cover.png"),
         
          text: [
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "The Pattern Pals: Levels in the Library",
            }
          ],
        },
        PageOne: {
          img: require("../Pictures/book3/1 Library.jpg"),
          question: "Why do you think Clara asked Zoe to use her inside voice?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "“Books!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "squawked Zoe. It was her first library visit.",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "“Shh! Clara whispered.”",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "“Use your inside voice.”",
            },
          ],
        },

        PageTwo: {
          img: require("../Pictures/book3/2 Library.jpg"),
          question: "How would you arrange your books in stacks?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "“What can we do here?”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "asked Zoe.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“We can pick out books,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "said Clara.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Each of my stacks has one more book than the last.”",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Let’s count them one book. One, two books. One, two, three books.”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "The End.",
            },
          ],
        },

        PageThree: {
          img: require("../Pictures/book3/3 Library.jpg"),
          question: "If Clara added one more stack, how many books should that stack have?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "“I made the same pattern!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "squawked Zoe.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "“See one book, one, two books, One, two, three books!”",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Nice Work.”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Clara whispered.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "“Let's read quietly.”",
            },
                        {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "“We have to be quiet in this section.”",
            },
          ],
        },

        PageFour: {
          img: require("../Pictures/book3/4 Library.jpg"),
          question: "How do you think Zoe is feeling?",
          text: [
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Zoe grabbed a book. She bumped into a bookshelf.",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Thump.",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Shh! said Clara.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“Oops!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "exclaimed Zoe.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“I'll put them back!”",
            },
          ],
        },
        PageFive: {
          img: require("../Pictures/book3/5 Library.jpg"),
          question: "How many books will the next shelf have?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“The top shelf has one book, the next has two”",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“and the next has three”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "said Zoe.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“I forget what the others had.”",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Each shelf has one more than the one before,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "said Clara.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“You can follow the pattern.”",
            },
          ],
        },
        PageSix: {
          img: require("../Pictures/book3/6 Library.jpg"),
          question: "How do you think Clara and Zoe will arrange the buildings for their city?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“Done!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Zoe said.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“What's next?”",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“We can build a city,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "said Clara.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“That shouldn't be too noisy.”",
            },
          ],
        },
        PageSeven: {
          img: require("../Pictures/book3/7 Library.jpg"),
          question: "What pattern do the block buildings make?",
          text: [
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“This building has two blocks, the next one has four”",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“and the last one has six”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Clara said.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Each building has two more blocks than the last.”",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“Choo choo!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "sang Zoe.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“Next stop Pattern village!”",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“That's too noisy!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "reminded Clara.",
            },
          ],
        },
        PageEight: {
          img: require("../Pictures/book3/8 Library.jpg"),
          question: "What pattern would you follow to make a staircase out of cushions?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“Sorry,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Zoe said.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“Let's do something else.”",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“We can build a staircase and see our city from above.”",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Is that safe?”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Clara asked. Zoe didn't hear her. She was too busy building.",
            },
          ],
        },
        PageNine: {
          img: require("../Pictures/book3/9 Library.jpg"),
          question: "If they wanted a taller staircase, how many cushions would be in the next stack?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“Two cushions, then four, then six!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "said Zoe.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“See, I put four cushions here to match the last stack and then added two more on top.”",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“That makes six.”",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“I just followed the pattern.”",
            },
          ],
        },
        PageTen: {
          img: require("../Pictures/book3/10 Library.jpg"),
          question: "How do you think Clara is feeling?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“The cushions are the same pattern as the blocks,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Zoe said proudly.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“Each stack has two more blocks or cushions than the one before.”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "She teetered on the top.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Be careful!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Clara warned.",
            },
          ],
        },
        PageEleven: {
          img: require("../Pictures/book3/11 Library.jpg"),
          question: "Was Zoe's cushion staircase safe to climb?",
          text: [
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "CRASH!",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Blocks and cushions flew everywhere.",
            },
          ],
        },
        PageTwelve: {
          img: require("../Pictures/book3/12 Library.jpg"),
          question: "What do you think Clara is going to show Zoe?",
          text: [
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Are you okay?”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "asked Clara.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“Yeah,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "said Zoe.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“Being quiet in the library is hard.”",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“I know. I have something to cheer you up!”",
            },
          ],
        },
        PageThirteen: {
          img: require("../Pictures/book3/13 Library.jpg"),
          question: "What kind of patterns do you see in this section of the library?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“What's this?”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "asked Zoe.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“A place where we can read our books out loud!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "said Clara.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“I love it!”",
            },
          ],
        },

        PageFourteen: {
          img: require("../Pictures/book3/14 Library.jpg"),
          question: "What do you want to do when you grow up?",
          text: [
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Zoe acted out the story.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“and with her patterning skills, she became a civil engineer and built bridges,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "she squawked.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“The end!”",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“That was great!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Clara said.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Let's read more.”",
            },
          ],
        },

        PageFifteen: {
          img: require("../Pictures/book3/15 Library.jpg"),
          question: "What pattern are the lights above the stage?",
          text: [
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Thump. The books tumbled down.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“Clara,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Zoe said with a smile.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“I know,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Clara laughed.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“We have to be quiet in the library!”",
            },
          ],
        },
        },
      },
    },
];

